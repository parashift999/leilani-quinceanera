const { google } = require('googleapis');
const busboy = require('busboy');

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  console.log('Upload function called');
  console.log('Content-Type:', event.headers['content-type']);

  try {
    // Parse the multipart form data
    console.log('Parsing form data...');
    const { fields, files } = await parseMultipartForm(event);
    console.log('Form parsed. Fields:', Object.keys(fields), 'Files:', files.length);

    // Get Google Drive credentials from environment variables
    const credentials = {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    };

    const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

    console.log('Environment check:');
    console.log('- Client email:', credentials.client_email ? 'Set' : 'Missing');
    console.log('- Private key:', credentials.private_key ? 'Set' : 'Missing');
    console.log('- Folder ID:', FOLDER_ID ? 'Set' : 'Missing');

    if (!credentials.client_email || !credentials.private_key || !FOLDER_ID) {
      console.error('Missing environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Server configuration error. Please check environment variables.' 
        })
      };
    }

    // Authenticate with Google Drive
    console.log('Authenticating with Google Drive...');
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });

    const drive = google.drive({ version: 'v3', auth });
    console.log('Authentication successful');

    // Upload each file to Google Drive
    console.log(`Uploading ${files.length} file(s)...`);
    const uploadPromises = files.map(async (file, index) => {
      console.log(`Uploading file ${index + 1}: ${file.filename}`);
      
      const fileMetadata = {
        name: `${fields.guestName || 'Guest'}_${Date.now()}_${file.filename}`,
        parents: [FOLDER_ID]
      };

      const media = {
        mimeType: file.mimeType,
        body: Buffer.from(file.content, 'base64')
      };

      try {
        const response = await drive.files.create({
          requestBody: fileMetadata,
          media: media,
          fields: 'id, name, webViewLink'
        });
        console.log(`File ${index + 1} uploaded successfully:`, response.data.name);
        return response.data;
      } catch (uploadError) {
        console.error(`Error uploading file ${index + 1}:`, uploadError);
        throw uploadError;
      }
    });

    const uploadedFiles = await Promise.all(uploadPromises);
    console.log('All files uploaded successfully');

    // Log the submission details
    const submissionData = {
      guestName: fields.guestName,
      guestEmail: fields.guestEmail,
      message: fields.message,
      timestamp: new Date().toISOString(),
      filesUploaded: uploadedFiles.length,
      fileLinks: uploadedFiles.map(f => f.webViewLink)
    };

    console.log('Submission complete:', JSON.stringify(submissionData, null, 2));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Photos uploaded successfully!',
        filesUploaded: uploadedFiles.length
      })
    };

  } catch (error) {
    console.error('Upload error:', error);
    console.error('Error stack:', error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to upload photos. Please try again.',
        details: error.message
      })
    };
  }
};

// Helper function to parse multipart form data
function parseMultipartForm(event) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];

    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    
    if (!contentType) {
      reject(new Error('No content-type header'));
      return;
    }

    const bb = busboy({
      headers: {
        'content-type': contentType
      }
    });

    bb.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];

      console.log(`Receiving file: ${filename} (${mimeType})`);

      file.on('data', (data) => {
        chunks.push(data);
      });

      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`File received: ${filename}, size: ${buffer.length} bytes`);
        files.push({
          fieldname,
          filename,
          mimeType,
          content: buffer.toString('base64')
        });
      });
    });

    bb.on('field', (fieldname, value) => {
      console.log(`Field: ${fieldname} = ${value}`);
      fields[fieldname] = value;
    });

    bb.on('finish', () => {
      console.log('Form parsing complete');
      resolve({ fields, files });
    });

    bb.on('error', (error) => {
      console.error('Busboy error:', error);
      reject(error);
    });

    // Decode base64 body if needed
    const body = event.isBase64Encoded 
      ? Buffer.from(event.body, 'base64')
      : event.body;

    bb.write(body);
    bb.end();
  });
}
