import React, { useEffect, useState } from 'react';
import './FolderPage.css';

function FolderPage({ token, keycloak, bucketName, endPoint, accessKey, secretKey, onBackToBuckets }) {
  const [objects, setObjects] = useState([]);
  const [folders, setFolders] = useState([]);
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [error, setError] = useState(null);
  const [parentFolders, setParentFolders] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [thumbnailMap, setThumbnailMap] = useState({});
  const [dropdownOpen, setDropdownOpen] = useState(null);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [tagList, setTagList] = useState([]);
  const [tagFileKey, setTagFileKey] = useState(null);
  const [version, setVersion] = useState(false); 
  const [versioningEnabled, setVersioningEnabled] = useState(""); // "true", "false"
  const [currentFile, setCurrentFile] = useState("");
  const [mapTags, setMapTags] = useState(true);


  useEffect(() => {
    fetchObjects();
  }, [bucketName]);

  useEffect(() => {
    fetchObjects(currentPrefix);
  }, [version]);

  useEffect(() => {
    if (!mapTags || !bucketName) return; // Skip if no bucket is selected

    const mapBucketTags = async () => {
      try {
        const res = await fetch('http://localhost:5050/bucket-tag-mapping', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            endPoint,
            accessKey,
            secretKey,
            bucketName,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          console.log(`✅ Bucket "${bucketName}" tags mapped successfully:`, data.message);
        } else {
          console.error(`❌ Failed to map tags for "${bucketName}":`, data.error);
        }
      } catch (err) {
        console.error(`❌ Request error for "${bucketName}":`, err.message);
      }
    };

    mapBucketTags();
    setMapTags(false); // Reset after mapping
  }, [bucketName, mapTags]);



  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.dropdown-container')) {
        setDropdownOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchThumbnails = async () => {
    try {
      const res = await fetch('http://localhost:5050/thumbnails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endPoint, accessKey, secretKey, bucketName }),
      });

      const data = await res.json();
      if (res.ok) {
        const map = {};
        for (const item of data.thumbnails) {
          map[item.key] = item.url;
        }
        setThumbnailMap(map);
      } else {
        console.error(data.error || 'Failed to get thumbnails');
      }
    } catch (err) {
      console.error('Thumbnail fetch error', err);
    }
  };

  useEffect(() => {
    const fetchVersioningStatus = async () => {
      try {
        const res = await fetch('http://localhost:5050/check-versioning', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ endPoint, accessKey, secretKey, bucketName }),
        });

        const data = await res.json();
        if (res.ok) {
          setVersioningEnabled(data.versioning); // "true" or "false" string
        } else {
          console.warn('❌ Could not fetch versioning status:', data.error);
        }
      } catch (err) {
        console.error('❌ Versioning fetch error:', err);
      }
    };

    fetchVersioningStatus();
  }, [bucketName]); // Re-run when bucketName changes


  const fetchObjects = async (prefix = '') => {
    setCurrentPrefix(prefix);
    setObjects([]); 
    setFolders([]); 

    const url = version
      ? 'http://localhost:5050/list-object-versions'
      : 'http://localhost:5050/list-objects';

    const body = JSON.stringify({ endPoint, accessKey, secretKey, bucketName, prefix });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body
      });

      const data = await res.json();

      if (res.ok) {
        const fileList = version ? data.versions : data.files;

        const filteredFiles = fileList.filter(obj => {
          const key = obj.Key;
          if (key === prefix && obj.Size === 0) return false;
          const relativePath = key.slice(prefix.length);
          return !relativePath.includes('/');
        });

        setObjects(filteredFiles);
        setFolders((data.folders || []).filter(f => f.Prefix !== prefix));

        if (!version) fetchThumbnails();
      } else {
        setError(data.error || 'Error listing objects');
      }
    } catch (err) {
      setError('Error contacting backend for objects');
    }
  };



  const deleteItem = async (key, isFolder, versionId = null) => {
    const confirmed = window.confirm(`Delete ${isFolder ? 'folder' : 'file'} ${key}?`);
    if (!confirmed) return;

    try {
      const res = await fetch('http://localhost:5050/delete', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endPoint, accessKey, secretKey, bucketName, key, isFolder, versionId }),
      });

      const result = await res.json();
      alert(result.message || result.error);
      fetchObjects(currentPrefix);
      setMapTags(true); // Reset tag mapping after deletion
    } catch (err) {
      alert('Error deleting item');
    }
  };


  const renameFile = async (oldKey) => {
    const oldName = oldKey.split('/').pop();
    const extension = oldName.split('.').pop().toLowerCase();
    const newName = prompt(`Rename "${oldName}" to:`);

    if (!newName || newName === oldName) return;

    const newKey = currentPrefix + newName + '.' + extension;

    try {
      const res = await fetch('http://localhost:5050/rename', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endPoint, accessKey, secretKey, bucketName, oldKey, newKey }),
      });

      const result = await res.json();

      if (res.ok) {
        alert(`✅ Renamed to: ${newName}`);
        fetchObjects(currentPrefix);
      } else {
        alert(`❌ Rename failed: ${result.error}`);
      }
    } catch (err) {
      alert('❌ Error renaming file');
    }
  };


  const createFolder = async (e) => {
    e.preventDefault();
    const folderName = e.target.folderName.value.trim();
    if (!folderName) return alert("Enter a folder name");

    const fullKey = `${currentPrefix}${folderName}/`;

    try {
      const res = await fetch('http://localhost:5050/create-folder', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endPoint, accessKey, secretKey, bucketName, key: fullKey }),
      });

      const result = await res.json();
      if (res.ok) {
        alert(`✅ Folder created: ${folderName}`);
        fetchObjects(currentPrefix);
      } else {
        alert(`❌ Failed to create folder: ${result.error}`);
      }
    } catch (err) {
      alert('❌ Folder creation error');
    }
  };

  const uploadFile = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert('Select a file');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('endPoint', endPoint);
    formData.append('accessKey', accessKey);
    formData.append('secretKey', secretKey);
    formData.append('bucketName', bucketName);
    formData.append('prefix', currentPrefix);

    try {
      const res = await fetch('http://localhost:5050/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData,
      });
      const result = await res.json();
      if (res.ok) {
        alert(`✅ Uploaded: ${result.key}`);
        setSelectedFile(null);
        fetchObjects(currentPrefix);
      } else {
        alert(`❌ Upload failed: ${result.error}`);
      }
    } catch {
      alert('❌ Upload error');
    }
  };

  const chatWithFile = async (key, question) => {
    let typePDF = false;
    if (key.toLowerCase().endsWith('.pdf')) {
      typePDF = true;
    }

    try {
      const res = await fetch('http://localhost:5050/chat-with-file', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endPoint,
          accessKey,
          secretKey,
          bucketName,
          key,
          typePDF, // Pass the typePDF flag
          question,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.answer) {
          return data.answer; // Return the answer to be displayed
        } else {
          console.log("line 324, folder.js");
        }
      }
    } catch(err) {
      console.error('❌ Error chatting with file:', err);
      console.log("line 329, folder.js");
    };
  };

  const autoTag = async (key) => {
    let typePDF = false;
    if (key.toLowerCase().endsWith('.pdf')) {
      typePDF = true;
    }

    try {
      const res = await fetch('http://localhost:5050/auto-tag-file', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endPoint,
          accessKey,
          secretKey,
          bucketName,
          key,
          typePDF, // Pass the typePDF flag
        }),
      });

      // Optionally handle the response here
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Unknown error occurred during auto-tagging');
      } else{
        alert(`✅ Key: Value pair "${data.tag.Key}: ${data.tag.Value}" has been set`);

      }

      console.log('✅ Auto-tagging successful:', data.tags);
      return data.tags; // or update UI state with tags

    } catch (err) {
      console.error('❌ Auto-tagging error:', err);
      alert('❌ Error auto-tagging file');
    };
  };

  const manageTags = async (key) => {
    const tagsInput = prompt('Enter tag for this file:');
    const valueInput = prompt('Enter value for this tag:');
    if (tagsInput === null) return;
    if (valueInput === null) return;

    try {
      const res = await fetch('http://localhost:5050/set-tags', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endPoint,
          accessKey,
          secretKey,
          bucketName,
          key,
          tag: tagsInput,
          value: valueInput,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        alert('✅ Tags updated successfully!');
      } else {
        alert(`❌ Failed to update tags: ${data.error}`);
      }
    } catch (err) {
      alert('❌ Error updating tags');
    }
  };

  const viewTags = async (key) => {
    setCurrentFile(key);
    try {
      const res = await fetch('http://localhost:5050/get-tags', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endPoint, accessKey, secretKey, bucketName, key }),
      });

      const data = await res.json();
      if (res.ok) {
        setTagList(data.tags);
        setTagFileKey(key);
        setShowTagsModal(true);
      } else {
        alert(`❌ Could not fetch tags: ${data.error}`);
      }
    } catch (err) {
      alert('❌ Error fetching tags');
    }
  };

  const deleteTag = async (tagKey) => {
    if (!window.confirm(`Delete tag "${tagKey}"?`)) return;

    try {
      const res = await fetch('http://localhost:5050/delete-tag', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endPoint, accessKey, secretKey, bucketName,
          key: tagFileKey,
          tagKey
        }),
      });

      const data = await res.json();
      if (res.ok) {
        alert('✅ Tag deleted');
        viewTags(tagFileKey); // Refresh list
        setMapTags(true); // Reset tag mapping after deletion
      } else {
        alert(`❌ Failed: ${data.error}`);
      }
    } catch (err) {
      alert('❌ Error deleting tag');
    }
  };

  const shareFile = async (key) => {
    const expiresInMin = prompt('Enter number of minutes for which the URL should be active:');
    const expiresIn = expiresInMin * 60
    try {
      const res = await fetch('http://localhost:5050/generate-share-url', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endPoint,
          accessKey,
          secretKey,
          bucketName,
          key,
          expiresIn,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        navigator.clipboard.writeText(data.url).then(() => {
          alert(`✅ Shareable link copied:\n${data.url}`);
        }).catch(err => {
          console.warn('⚠️ Clipboard failed:', err);
          prompt("⚠️ Clipboard access blocked. Copy the link manually:", data.url);
        });
      } else {
        alert(`❌ Error generating share URL: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('❌ Failed to generate share link');
    }
  };


  const downloadFile = async (key) => {
    try {
      const res = await fetch('http://localhost:5050/download-url', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endPoint, accessKey, secretKey, bucketName, key }),
      });

      const data = await res.json();
      if (res.ok) {
        const link = document.createElement('a');
        link.href = data.url;
        link.download = key.split('/').pop(); // Optional: trigger download
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        alert(`❌ Failed to generate download URL: ${data.error}`);
      }
    } catch (err) {
      alert('❌ Error downloading file');
    }
  };



  return (
    <div className="folder">
      <header className="folderAppHeader">
        <button className="folder-back-button" onClick={() => {
          if (parentFolders < 1) {
            onBackToBuckets();
          } else {
            const parts = currentPrefix.replace(/\/$/, '').split('/');
            parts.pop();
            const parent = parts.length ? parts.join('/') + '/' : '';
            setParentFolders(prev => prev - 1);
            fetchObjects(parent);
            const folderParts = currentPrefix.split('/').filter(Boolean);
          }
        }}>
          ← Back
        </button>

        <button className="logout-button" onClick={keycloak.logout}>
          Logout
        </button>

        <div className="folderHeader breadcrumb">
          <span style={{ marginRight: '0.5rem', color: '#ffffff', fontWeight: 700 }}>Contents of</span>
          <span className="breadcrumb-segment" onClick={() => {
            setParentFolders(0);
            fetchObjects('');
          }}>
            {bucketName}
          </span>
          {currentPrefix && currentPrefix.split('/').filter(Boolean).map((folder, index, arr) => {
            const path = arr.slice(0, index + 1).join('/') + '/';
            return (
              <React.Fragment key={path}>
                <span className="breadcrumb-divider"> / </span>
                <span
                  className="breadcrumb-segment"
                  onClick={() => {
                    setParentFolders(index + 1);
                    fetchObjects(path);
                  }}
                >
                  {folder}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        {error && (
          <div className="error-box">
            <strong>❗ Error:</strong> <span>{error}</span>
          </div>
        )}
        <div className="columns">
          { versioningEnabled == "false" ? (<div></div>) : (
            <div className="version-toggle">
                <span className= "version-label"> Show Versions </span>   
                {/* add toggle switch here */}
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={version}
                    onChange={() => setVersion(prev => !prev)}
                  />
                  <span className="slider round"></span>
                </label>

            </div>
          )}
          {/* <div className="folder-file-container"> */}
          <div>
            <div className="folder-column">
              <h3>📁 Folders</h3>
              {folders.length === 0 ? (
                <p>No folders found.</p>
              ) : (
                <ul>
                  {folders.map(folder => {
                    const folderName = folder.Prefix.split('/').filter(Boolean).pop();
                    return (
                      <li key={folder.Prefix} className="folder-hstack">
                        <span className="folderName">
                        <button
                        className="folder-button-large"
                        onClick={() => {
                          setParentFolders(prev => prev + 1);
                          fetchObjects(folder.Prefix);
                        }}
                      >
                        📂 {folderName}
                      </button>
                      </span>
                      <div className="dropdown-container folder-dropdown-container">
                        <button
                          className="folder-menu-button"
                          onClick={() =>
                            setDropdownOpen(dropdownOpen === folder.Prefix ? null : folder.Prefix)
                          }
                        >
                          ⋮
                        </button>

                        {dropdownOpen === folder.Prefix && (
                          <div className="dropdown-menu">
                            <button
                              onClick={() => {
                                deleteItem(folder.Prefix, true);
                                setDropdownOpen(null);
                              }}
                            >
                              ❌ Delete
                            </button>
                            <button onClick={() => { manageTags(folder.Prefix); setDropdownOpen(null); }}>🏷️ Add Tags</button>
                            <button onClick={() => { viewTags(folder.Prefix); setDropdownOpen(null); }}>🏷️ Manage Current Tags</button>
                          </div>
                        )}
                      </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="file-column">
              <h3>📄 Files</h3>
              {objects.length === 0 ? (
                <p>No files found.</p>
              ) : (
                <ul>
                  { version ? (
                    <li className='file-hstack'>
                      <span className='filename' style={{ fontWeight: 'bold', paddingRight: '140px', paddingLeft: '0px' }}>
                        File Name
                      </span>    
                      <span className='fileHeaderName' style={{ paddingRight: '170px' }}>
                        Size
                      </span>    
                      <span className='fileHeaderName' style={{ paddingRight: '160px' }}>
                        File Type
                      </span>
                      <span className='fileHeaderName' style={{ paddingRight: '80px' }}>
                        Version ID
                      </span>
                      <span className='fileHeaderName'>
                        Action
                      </span>   
                    </li>
                  ):(
                  <li className='file-hstack'>
                    <span className='fileHeaderName'>
                      Thumbnail
                    </span>    
                    {/* <span className='fileHeaderName' style={{ paddingRight: '200px' }}> */}
                    <span className='filename' style={{ fontWeight: 'bold', paddingRight: '110px', paddingLeft: '20px' }}>
                      File Name
                    </span>    
                    <span className='fileHeaderName' style={{ paddingRight: '170px' }}>
                      Size
                    </span>    
                    <span className='fileHeaderName' style={{ paddingRight: '160px' }}>
                      File Type
                    </span>
                    <span className='fileHeaderName'>
                      Action
                    </span>   
                  </li>
                  )}
                  {objects.map((obj) => {
                    const fileName = obj.Key.split('/').pop();
                    const isSuitableFile = fileName.toLowerCase().endsWith('.txt') || fileName.toLowerCase().endsWith('.pdf');


                    const sizeKB = (obj.Size / 1024).toFixed(2);
                    const sizeMB = (obj.Size / (1024 * 1024)).toFixed(2);
                    const sizeGB = (obj.Size / (1024 * 1024 * 1024)).toFixed(2);

                    if (!fileName) return null;

                    const uniqueId = version ? `${obj.Key}__${obj.VersionId}` : obj.Key;

                    return (
                      <li key={uniqueId} className="file-hstack">
                        {version ? null : (() => {
                          const lowerKey = obj.Key.toLowerCase();
                          const isImage = lowerKey.match(/\.(jpg|jpeg|png|gif|webp)$/);
                          const isPDF = lowerKey.endsWith('.pdf');
                          const isVideo = lowerKey.match(/\.(mp4|mkv|m4v)$/);
                          const thumbURL = thumbnailMap[obj.Key];

                          if (thumbURL) {
                            if (isPDF) {
                              return (
                                <embed
                                  src={thumbURL + '#toolbar=0&navpanes=0&scrollbar=0'}
                                  type="application/pdf"
                                  width="50"
                                  height="50"
                                  style={{ borderRadius: '4px', marginRight: '1rem', border: '1px solid #ccc' }}
                                />
                              );
                            } else if (isImage) {
                              return (
                                <img
                                  src={thumbURL}
                                  alt={`thumbnail-${fileName}`}
                                  style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '4px', marginRight: '1rem' }}
                                />
                              );
                            } else if (isVideo) {
                              return (
                                <video
                                  src={thumbURL}
                                  width="50"
                                  height="50"
                                  muted
                                  preload="metadata"
                                  style={{ objectFit: 'cover', borderRadius: '4px', marginRight: '1rem', border: '1px solid #ccc' }}
                                />
                              );
                            } else {
                              return (
                                <img
                                  src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Question_book-new.svg/50px-Question_book-new.svg.png"
                                  // alt="no-preview"
                                  style={{ width: '50px', height: '50px', objectFit: 'contain', borderRadius: '4px', marginRight: '1rem', border: '1px solid #ccc' }}
                                />
                              );
                            }
                          } else {
                            return (
                              <img
                                src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Question_book-new.svg/50px-Question_book-new.svg.png"
                                // alt="no-preview"
                                style={{ width: '50px', height: '50px', objectFit: 'contain', borderRadius: '4px', marginRight: '1rem', border: '1px solid #ccc' }}
                              />
                            );
                          }
                        })()}

                        <span className="filename">{fileName} </span>

                        { typeof obj.Size === 'number' ? (
                          sizeKB < 1024 ? (
                            <span className="sizename">{sizeKB} KB</span>
                          ) : (
                            sizeMB < 1024 ? (
                              <span className="sizename">{sizeMB} MB</span>
                            ) : (
                              <span className="sizename">{sizeGB} GB</span>
                            )
                          )
                        ) : (
                          <span className="sizename">N/A</span> // or 'N/A', or nothing
                        )}


                        {version ? (
                          obj.IsDeleteMarker ? (
                            <span className='fileType'> Delete Marker</span>
                          ) : (
                            obj.IsLatest ? (
                              <span className="fileType">
                                {fileName.split('.').pop().toLowerCase()}
                              </span>
                            ) : (
                              <span className='fileType'> Version</span>
                            )
                          )
                        ) : (
                          <span className="fileType">
                            {fileName.split('.').pop().toLowerCase()}
                          </span>
                        )}
                        {version ? (
                            <span className="filename">{obj.VersionId}</span>
                        ): 
                        (<div></div>)}
                        <div className="dropdown-container">
                          <button className="menu-button" onClick={() => setDropdownOpen(dropdownOpen === uniqueId ? null : uniqueId)}>⋮</button>
                          {dropdownOpen === uniqueId && (
                            <div className="dropdown-menu">
                              {version ? (<div></div>): (<button onClick={() => { renameFile(obj.Key); setDropdownOpen(null); }}>✏️ Rename</button>)}
                              <button onClick={() => {
                                deleteItem(obj.Key, false, version ? obj.VersionId : null);
                                setDropdownOpen(null);
                              }}> ❌ Delete</button>
                              <button onClick={() => { manageTags(obj.Key, false); setDropdownOpen(null); }}>🏷️ Add Tags</button>
                              <button onClick={() => { viewTags(obj.Key); setDropdownOpen(null); }}>🏷️ Manage Current Tags</button>
                              {isSuitableFile ? (
                                <button onClick={() => { autoTag(obj.Key); setDropdownOpen(null); }}>🤖🏷️ Auto-Tag</button>
                              ) : (<></>)}
                              {isSuitableFile ? (
                                <button onClick={() => {
                                  const question = prompt('Ask a question about this file:');
                                  if (question) {
                                    chatWithFile(obj.Key, question).then(answer => {
                                      if (answer) {
                                        alert(`🤖 Answer: ${answer}`);
                                      } else {
                                        console.log("line 833, folderPage.js");
                                      }
                                    });
                                  }
                                  setDropdownOpen(null);
                                }}>💬 Chat with File</button>
                              ) : (<></>)}
                              <button
                                onClick={() => {
                                  downloadFile(obj.Key);
                                  setDropdownOpen(null);
                                }}
                              >
                                ⬇️ Download
                              </button>

                              <button onClick={() => {
                                shareFile(obj.Key);
                                setTimeout(() => setDropdownOpen(null), 100); // Delay closing to avoid breaking click context
                              }}>🔗 Share</button>
                              
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="action-row">
            <form className="form-inline folder-form" onSubmit={createFolder}>
              <input className="FolderInputBox" type="text" name="folderName" placeholder="Enter folder name" />
              <button className="button-large" type="submit">📁 Create Folder</button>
            </form>

            <form className="form-inline file-form" onSubmit={uploadFile}>
              <label className={`custom-file-upload ${selectedFile ? 'file-selected' : ''}`}>
                <input type="file" name="file" onChange={(e) => setSelectedFile(e.target.files[0])} />
                📁 Choose File
              </label>
              <button className="button-large" type="submit">⬆️ Upload File</button>
            </form>
          </div>
        </div>
      </header>

      {showTagsModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>🏷️ Tags for: {currentFile.split('/').filter(Boolean).pop()}</h3>
            {tagList.length === 0 ? (
              <p>No tags found.</p>
            ) : (
              <ul>
                {tagList.map(({ Key, Value }) => (
                  <li
                    key={Key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',              // vertical centering
                      marginBottom: '0.5rem',
                      padding: '0.5rem 1rem',
                      background: '#f8f8f8',
                      borderRadius: '8px',
                    }}
                  >
                    <span
                      style={{
                        flex: 1,                         // take available space
                        textAlign: 'center',            // center the tag text
                        fontWeight: '500',
                        wordBreak: 'break-word'
                      }}
                    >
                      {Key}: {Value}
                    </span>
                    <button
                      className="delete-tag-button"
                      onClick={() => deleteTag(Key)}
                      style={{
                        marginLeft: '1rem',
                        flexShrink: 0                   // prevent shrinking
                      }}
                    >
                      ❌ Delete
                    </button>
                  </li>
                ))}
              </ul>
              
            )}
            <button className="button-large" onClick={() => setShowTagsModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FolderPage;