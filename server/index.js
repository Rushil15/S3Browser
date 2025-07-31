const express = require('express');
const cors = require('cors');
const multer = require('multer');
const upload = multer();
const AWS = require('aws-sdk');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
app.use(cors());
app.use(express.json());
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const pdfParse = require('pdf-parse');

const bucketTagKeysMap = {}; // Cache: bucketName => Set of tag keys

require('dotenv').config();

const PORT = process.env.PORT || 5050;
const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL;
const JWKS_URI = process.env.KEYCLOAK_JWKS_URI;


app.get('/serverOnlineTest', (req, res) => {
  res.send('🚀 ZATA Backend is running!');
});

const client = jwksClient({
  jwksUri: JWKS_URI
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    if (err || !key) {
      console.error('❌ Error getting signing key:', err);
      callback(err || new Error('Signing key not found'));
      return;
    }

    const signingKey = key.getPublicKey?.();
    if (!signingKey) {
      console.error('❌ getPublicKey is not available on the key object');
      callback(new Error('Invalid key object'));
      return;
    }

    callback(null, signingKey);
  });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.error('❌ No Authorization header');
    return res.sendStatus(401);
  }

  const token = authHeader.split(' ')[1];
  

  jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
    if (err) {
      console.error('❌ JWT verification failed:', err.message);
      return res.sendStatus(403);
    }

  
    req.user = decoded;
    next();
  });
}



// List Buckets
app.post('/list-buckets', authenticate, (req, res) => {
  const { endPoint, accessKey, secretKey } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  s3.listBuckets((err, data) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(data.Buckets);
  });
});

// List Objects
app.post('/list-objects', authenticate, (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, prefix = '' } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  s3.listObjectsV2(
    {
      Bucket: bucketName,
      Prefix: prefix,
      Delimiter: '/',
    },
    (err, data) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json({
        folders: data.CommonPrefixes || [],
        files: data.Contents || [],
      });
    }
  );
});

// Rename
const encodeKey = (key) =>
  key
    .split('/')
    .map(encodeURIComponent)
    .join('/');

app.post('/rename', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, oldKey, newKey } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  const encodedSource = `${bucketName}/${encodeKey(oldKey)}`;

  try {
    await s3.copyObject({
      Bucket: bucketName,
      CopySource: encodedSource,
      Key: newKey,
    }).promise();

    await s3.deleteObject({
      Bucket: bucketName,
      Key: oldKey,
    }).promise();

    res.json({ message: `Renamed to ${newKey}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload
app.post('/upload', authenticate, upload.single('file'), (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, prefix = '' } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  const key = prefix + file.originalname;

  s3.upload({
    Bucket: bucketName,
    Key: key,
    Body: file.buffer,
  }, (err, data) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({ success: true, key: data.Key });
  });
});

// Create Folder
app.post('/create-folder', authenticate, (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  s3.putObject({
    Bucket: bucketName,
    Key: key,
    Body: '',
  }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Folder "${key}" created` });
  });
});

// Delete File or Folder
app.delete('/delete', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key, isFolder, versionId } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  try {
    if (isFolder) {
      const listedObjects = await s3.listObjectsV2({
        Bucket: bucketName,
        Prefix: key,
      }).promise();

      if (!listedObjects.Contents.length) {
        return res.status(404).json({ error: 'Folder is empty or not found' });
      }

      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: listedObjects.Contents.map((obj) => ({ Key: obj.Key })),
        },
      };

      await s3.deleteObjects(deleteParams).promise();
      return res.json({ message: 'Folder deleted' });

    } else {
      const deleteParams = {
        Bucket: bucketName,
        Key: key,
        ...(versionId && { VersionId: versionId }) // ✅ Optional version ID
      };

      await s3.deleteObject(deleteParams).promise();
      return res.json({ message: versionId ? 'Version deleted' : 'File deleted' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thumbnails Endpoint (NEW)
app.post('/thumbnails', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName } = req.body;

  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    endpoint: `https://${endPoint}`,
    forcePathStyle: true,
  });

  try {
    const response = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucketName })
    );

    const videoAndImageFiles = (response.Contents || []).filter(obj =>
      obj.Key.match(/\.(jpg|jpeg|png|gif|webp|pdf|mp4|mkv|m4v|ppt|pptx|odp)$/i)
    );


    const urls = await Promise.all(videoAndImageFiles.map(async (file) => {
      const extension = file.Key.split('.').pop().toLowerCase();
      const isPDF = extension === 'pdf';

      const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: bucketName,
          Key: file.Key,
          ...(isPDF && {
            ResponseContentDisposition: 'inline',
            ResponseContentType: 'application/pdf',
          }),
        }),
        { expiresIn: 3600 }
      );

      return { key: file.Key, url: signedUrl };
    }));

    res.json({ thumbnails: urls });
  } catch (err) {
    console.error('[!] Thumbnail Error:', err.message);
    res.status(500).json({ error: 'Failed to generate thumbnails' });
  }
});

app.post('/set-tags', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key, tag, value } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  try {
    // Step 1: Get existing tags
    const existingTagsResponse = await s3.getObjectTagging({ Bucket: bucketName, Key: key }).promise();
    let tagSet = existingTagsResponse.TagSet || [];

    // Step 2: Check if the tag key already exists
    const index = tagSet.findIndex(t => t.Key === tag);
    if (index !== -1) {
      // If it exists, update it
      tagSet[index].Value = value;
    } else {
      // If not, add new tag
      tagSet.push({ Key: tag, Value: value });
    }

    // Step 3: Upload updated tags
    await s3.putObjectTagging({
      Bucket: bucketName,
      Key: key,
      Tagging: { TagSet: tagSet },
    }).promise();


    if (!bucketTagKeysMap[bucketName].has(tag)) {
      bucketTagKeysMap[bucketName].add(tag);
    }

    res.json({ message: '✅ Tag set successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// server/index.js
app.post('/get-tags', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  try {
    const data = await s3.getObjectTagging({ Bucket: bucketName, Key: key }).promise();
    res.json({ tags: data.TagSet || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/delete-tag', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key, tagKey } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  try {
    const data = await s3.getObjectTagging({ Bucket: bucketName, Key: key }).promise();
    const updatedTags = (data.TagSet || []).filter(t => t.Key !== tagKey);

    await s3.putObjectTagging({
      Bucket: bucketName,
      Key: key,
      Tagging: { TagSet: updatedTags },
    }).promise();

    res.json({ message: 'Tag deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/generate-share-url', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key, expiresIn = 3000 } = req.body;

  

  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    endpoint: endPoint.startsWith('http') ? endPoint : `https://${endPoint}`,
    forcePathStyle: true,
  });

  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });

    
    res.json({ url: signedUrl });
  } catch (err) {
    console.error('❌ Error generating share URL:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check if bucket versioning is enabled
app.post('/check-versioning', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  try {
    const data = await s3.getBucketVersioning({ Bucket: bucketName }).promise();

    if (data.Status === 'Enabled') {
      return res.json({ versioning: 'true' });
    } else if (data.Status === 'Suspended') {
      return res.json({ versioning: 'false' });
    } else {
      return res.json({ versioning: 'false' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/download-url', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key } = req.body;

  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    endpoint: `https://${endPoint}`,
    forcePathStyle: true,
  });

  try {
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucketName, Key: key }),
      { expiresIn: 10 }
    );

    res.json({ url: signedUrl });
  } catch (err) {
    console.error('❌ Error generating download URL:', err.message);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});



app.post('/list-object-versions', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, prefix = '' } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  try {
    let allVersions = [];
    let allFolders = new Set();
    let KeyMarker, VersionIdMarker;
    let isTruncated = true;

    while (isTruncated) {
      const response = await s3.listObjectVersions({
        Bucket: bucketName,
        Prefix: prefix,
        Delimiter: '/',
        KeyMarker,
        VersionIdMarker,
      }).promise();

      const versions = response.Versions || [];
      const deleteMarkers = (response.DeleteMarkers || []).map(dm => ({
        ...dm,
        IsDeleteMarker: true
      }));

      allVersions.push(...versions, ...deleteMarkers);

      if (response.CommonPrefixes) {
        response.CommonPrefixes.forEach(cp => allFolders.add(cp.Prefix));
      }

      isTruncated = response.IsTruncated;
      KeyMarker = response.NextKeyMarker;
      VersionIdMarker = response.NextVersionIdMarker;
    }

    // ✅ Send the versions and folders back
    res.json({
      versions: allVersions,
      folders: Array.from(allFolders).map(Prefix => ({ Prefix }))
    });

  } catch (err) {
    console.error('❌ Error fetching object versions:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/bucket-tag-mapping', async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  try {
    const files = await getAllFiles(s3, bucketName);
    console.log('✅ All files:', files);
    const allTags = await getAllTags(s3, bucketName, files);
    console.log('✅ All tags:', allTags);
    bucketTagKeysMap[bucketName] = allTags;
    console.log('✅ Bucket tag mapping complete:', bucketTagKeysMap);
    res.status(200).json({ message: 'Bucket tag mapping complete' });
  } catch (err) {
    console.error('❌ Failed in /bucket-tag-mapping:', err.message);
    res.status(500).json({ error: 'Failed to map bucket tags' });
  }
});


const getAllTags = async (s3, bucketName, allFiles) => {
  let allTags = new Set();
  try {
    for (const key of allFiles) {
      const existingTagsResponse = await s3.getObjectTagging({ Bucket: bucketName, Key: key }).promise();
      let tagSet = existingTagsResponse.TagSet || [];
      tagSet.forEach(tag => allTags.add(tag.Key));
    }
  } catch(err){
    console.error('❌ Error in getAllTags:', err.message);
    throw err;
  }
  return allTags;
}


const getAllFiles = async (s3, bucketName, prefix = '', allFiles = []) => {
  try {
    const data = await s3.listObjectsV2({
      Bucket: bucketName,
      Prefix: prefix,
      Delimiter: '/',
    }).promise();

    // Add files in current folder
    if (data.Contents) {
      for (const file of data.Contents) {
        // Skip the folder "placeholder" itself
        if (file.Key !== prefix) {
          allFiles.push(file.Key);
        }
      }
    }

    // Recurse into subfolders
    if (data.CommonPrefixes) {
      for (const folder of data.CommonPrefixes) {
        const folderPrefix = folder.Prefix;
        await getAllFiles(s3, bucketName, folderPrefix, allFiles);
      }
    }

    return allFiles;
  } catch (err) {
    console.error('❌ Error in getAllFiles:', err.message);
    throw err;
  }
};

app.post('/chat-with-file', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key, typePDF, question } = req.body
  console.log("line 621, server");
  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  let fileContent;
  if (typePDF) {
    fileContent = await extractPdfTextFromS3(s3, bucketName, key);
  } else {
    const s3Data = await s3.getObject({ Bucket: bucketName, Key: key }).promise();
    fileContent = s3Data.Body.toString('utf-8');
  }

  try {

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {role: "system", content: "you are an amazing assistant that can answer question from the document provided to you. You will be given a document and a question, and you will answer the question based on the document."},  
          { role: "user", content: `Document: ${fileContent}\n\nQuestion: ${question}` }],
      }),
    });
    const answer = await response.json();
    res.json({ answer: answer.choices[0].message.content || "No reply received." });
    console.log("line 655, server");
  } catch (err) {
    console.error("❌ Error extracting file content:", err);
    return res.status(500).json({ error: 'Failed to extract file content' });
  }

});


app.post('/auto-tag-file', authenticate, async (req, res) => {
  const { endPoint, accessKey, secretKey, bucketName, key, typePDF } = req.body;

  const s3 = new AWS.S3({
    endpoint: endPoint,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  const s3Data = await s3.getObject({ Bucket: bucketName, Key: key }).promise();
  let userMessage;

  if (typePDF) {
    userMessage = await extractPdfTextFromS3(s3, bucketName, key);
  } else {
    userMessage = s3Data.Body.toString('utf-8');
  }


  try {

    const existingTagsResponse = await s3.getObjectTagging({ Bucket: bucketName, Key: key }).promise();
    let tagSet = existingTagsResponse.TagSet || [];

    console.log("tagset:", tagSet);

    const tagString = tagSet.map(tag => `'${tag.Key}: ${tag.Value}'`).join(', ');
    console.log("Existing tags:", tagString);

    const existingKeys = Array.from(bucketTagKeysMap[bucketName] || []);
    const excludedTagString = tagSet.map(tag => `'${tag.Key}: ${tag.Value}'`).join(', ');
    const reusableKeys = existingKeys.filter(k => k.toLowerCase() !== "topic").join(', ');

    const systemMessage = `You are an expert tagging assistant. Your job is to generate one tag in the format: TagName, TagValue (comma separated).

    Guidelines:
    - Prefer reusing one of these existing tag names if appropriate: ${reusableKeys}.
    - Only create a new tag name if none of the above are a good fit.
    - Do NOT reuse any of these existing tag-value pairs: ${excludedTagString}.
    - NEVER use 'topic' as a tag name.
    - Your response must be exactly one line: TagName, TagValue (with a space after the comma).
    - If TagName or TagValue contain multiple words, replace spaces with underscores.
    - Do not add explanations or text before/after the tag.`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {role: "system", content: systemMessage},  
          { role: "user", content: userMessage }],
      }),
    });

    const data = await response.json();
    const botReply = data.choices[0]?.message?.content || "No reply received.";

    // const array = botReply.split(',').map(item => item.trim());
    const array = botReply.split(',');
    console.log(array)
    
    const tag = array[0];
    const value = array[1];

    
    
    tagSet.push({ Key: tag, Value: value });

    // Step 3: Upload updated tags
    await s3.putObjectTagging({
      Bucket: bucketName,
      Key: key,
      Tagging: { TagSet: tagSet },
    }).promise();

    if (!bucketTagKeysMap[bucketName].has(tag)) {
      bucketTagKeysMap[bucketName].add(tag);
    }

    res.json({ message: '✅ Tag set successfully', tag: { Key: tag, Value: value } });

    // res.send();

  } catch (err) {
    console.error("Error:", err);
    res.status(500).send({ error: err.message });
  }
});


const streamToBuffer = (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};


async function extractPdfTextFromS3(s3, bucketName, key) {
  const data = await s3.getObject({
    Bucket: bucketName,
    Key: key,
  }).promise();

  // If Body is already a Buffer, no need to stream
  const buffer = Buffer.isBuffer(data.Body)
    ? data.Body
    : await streamToBuffer(data.Body);

  const pdfData = await pdfParse(buffer);
  return pdfData.text;
}


app.listen(PORT, '0.0.0.0', () =>
  console.log(`✅ Backend running on http://localhost:${PORT}`)
);