const express = require('express');
const cors = require('cors');
// import Multer from "multer";
const Multer = require('multer')
const { google } = require('googleapis');
const fs = require("fs");
const { Readable } = require('stream')
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
const { file } = require('googleapis/build/src/apis/file');
const { clouddebugger } = require('googleapis/build/src/apis/clouddebugger');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const bufferToStream = (buffer) => Readable.from(buffer);


const multer = Multer({
  storage: Multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const authenticateGoogle = () => {
  console.log('in authenticateGoogle');
  const auth = new google.auth.GoogleAuth({
    keyFile: `${__dirname}/sholars-repository-google-drive-api.json`,
    scopes: "https://www.googleapis.com/auth/drive",
  });
  return auth;
};



const uploadToGoogleDrive = async (file, auth) => {
  console.log('in uploadToGoogleDrive');
  const fileMetadata = {
    name: file.originalname,
    mimeType: file.mimetype,
    parents: ["1JgmGKzevX0JFuW_nzDn3RtVhRmsVRo8M"],
  };
  console.log('file original name:', file.originalname, 'file mimetype:', file.mimetype);

  const media = {
    mimeType: file.mimetype,
    body: bufferToStream(file.buffer),
  };
  console.log('media:', media);

  const driveService = google.drive({ version: "v3", auth });

  try {
    const response = await driveService.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, name, webContentLink, webViewLink, thumbnailLink, createdTime",
    });

    const fileId = response.data.id;

    // Function to check if thumbnailLink is available
    const checkThumbnailAvailability = async () => {
      const fileDetails = await driveService.files.get({
        fileId: fileId,
        fields: "id, name, webContentLink, webViewLink, thumbnailLink, createdTime",
      });

      if (fileDetails.data.thumbnailLink) {
        return fileDetails.data.thumbnailLink;
      } else {
        // Retry after a delay (adjust as needed)
        await new Promise(resolve => setTimeout(resolve, 5000));
        return checkThumbnailAvailability();
      }
    };

    const thumbnailLink = await checkThumbnailAvailability();

    const responseData = {
      id: fileId,
      name: response.data.name,
      webContentLink: response.data.webContentLink,
      webViewLink: response.data.webViewLink,
      thumbnailLink: thumbnailLink,
      createdTime: response.data.createdTime,
    };

    console.log("Response From Google Drive API: ", responseData);

    return responseData;
  } catch (error) {
    console.error("Error uploading to Google Drive:", error.message);
    throw error;
  }
};


// Getting file from the drive =======================================================================================================

const listFilesInGoogleDrive = async (auth) => {
  const driveService = google.drive({ version: 'v3', auth });
  const pageSize = 10;
  let files = [];
  let nextPageToken = null;

  do {
    const response = await driveService.files.list({
      pageSize,
      pageToken: nextPageToken,
      fields: 'nextPageToken, files(id, name, webContentLink, webViewLink, thumbnailLink, mimeType)',
    });

    const pageFiles = response.data.files.filter((file) => file.mimeType !== 'application/vnd.google-apps.folder');
    files = files.concat(pageFiles);
    nextPageToken = response.data.nextPageToken;

  } while (nextPageToken);

  return files;
};

// Getting file from the drive end =======================================================================================================

const deleteFile = (filePath) => {
  fs.unlink(filePath, () => {
    console.log("file deleted");
  });
};

const uri = `mongodb+srv://mredha:iym3muWCUf6exJaz@cluster0.gn8dbxu.mongodb.net/`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const usersCollection = client.db('scholarsRepository').collection('usersCollection');
    const resourceTitleInfoCollection = client.db('scholarsRepository').collection('resourceTitleInfoCollection');
    const filesCollection = client.db('scholarsRepository').collection('filesCollection');
    const scoresCollection = client.db('scholarsRepository').collection('scoresCollection');

    app.post('/users', async (req, res) => {
      const user = req.body;
      console.log(user);
      const userId = generateAlphanumericUserId(10);
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      user.userId = userId;

      const newScore = {
        name: user.name,
        email: user.email,
        photoURL:null,
        points: 0,
      }

      if (existingUser) {
        return res.send({ message: 'user already exists' });
      }

      const result = await usersCollection.insertOne(user);
      const result1 = await scoresCollection.insertOne(newScore);
      console.log(result);
      res.send(result);
    });

    app.get('/users', async (req, res) => {
      const result = await usersCollection.find().toArray();
      console.log('users:', result);
      res.send(result);
    });


    
    app.get('/leader-board/all-contributor', async (req, res) => {
      const result = await scoresCollection.find().toArray();
      console.log('users:', result);
      res.send(result);
    });

    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });


    // updating user info api -------------------------------------------------------------------------------------------
    app.patch('/users/profile-update/:email', async (req, res) => {
      const email = (req.params.email);
      console.log("update api is hit.");

      const filter = { email: email };
      const body = req.body;
      let updateDoc = {
        $set: {
          photoURL: body.photoURL,
          name: body.name,
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      const result1 = await scoresCollection.updateOne(filter, updateDoc);
      const result2 = await filesCollection.updateMany(filter, updateDoc);
      console.log(result);
      res.send(result);
    });

    // is admin checking 
    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === 'admin' };
      console.log(result);
      res.send(result);
    });

    // get role 
    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const query = {
        email: email
      };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    // Role changing api 
    app.patch('/users/admin/role-change/:email', async (req, res) => {
      const email = (req.params.email);
      const role = req.body.role;
      const filter = { email: email };
      let updateDoc = {
        $set: {
          role: role
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });



    // get my contribution
    app.get('/user/all-contribution/:email', async (req, res) => {
      const email = req.params.email;
      const query = {
        email: email
      };
      const result = await filesCollection.find(query).toArray();
      console.log("data found ", result.length, " for ", email);
      res.send(result);
    });
    // get all files api
    app.get('/admin/all-contribution', async (req, res) => {
      const result = await filesCollection.find().toArray();
      console.log("data found ", result.length);
      res.send(result);
    });

    // insert new resource info title api...

    app.post('/admin/include-resource-title', async (req, res) => {
      const newDoc = req.body;
      const result = await resourceTitleInfoCollection.insertOne(newDoc);
      console.log(result);
      res.send(result);

    });


    app.get('/resource-title-info', async (req, res) => {
      try {
        const resourceTitleInfoCollection = client.db('scholarsRepository').collection('resourceTitleInfoCollection');
        const result = await resourceTitleInfoCollection.find().toArray();
        res.status(200).json(result);
      } catch (error) {
        console.error('Error fetching resource title info:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
      }
    });




    // new file details posting in mongoDB
    app.post('/upload/new-file', async (req, res) => {
      const newDoc = req.body;


      const filter = { email: newDoc.email };
      console.log("Filtered by: ",filter);
      const result1 = await scoresCollection.findOne(filter);
      const updatePoints = result1.points + 5;
      let updateDoc = {
        $set: {
          points: updatePoints,
        },
      };

      const result2 = await scoresCollection.updateOne(filter, updateDoc);

      const result = await filesCollection.insertOne(newDoc);
      console.log(result);
      res.send(result);
    });

    //fetching file api 
    app.get('/all-files', async (req, res) => {
      const result = await filesCollection.find().toArray();
      res.send(result);
    });



    // getting all resource data using query keys
    app.get('/get-resource-data', async (req, res) => {
      const { universityName, departmentName, semester, courseName } = req.query;

      const query = {
        universityName,
        departmentName,
        semester,
        courseName,
      };
      console.log("query: ", query);
      const result = await filesCollection.find(query).toArray();
      console.log("result: ", result);
      res.json(result);

    })

    //get recent question file api 
    app.get('/recent-questions', async (req, res) => {
      try {
        const filter = { docType: 'question' } // Use docType filter if provided
    
        const recentQuestions = await filesCollection.find(filter).sort({ createdTime: -1 }).limit(8).toArray();
        console.log("data found ", recentQuestions.length);
    
        res.json(recentQuestions);
      } catch (error) {
        console.error('Error fetching recent questions:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
    //get recent question file api 
    app.get('/recent-notes', async (req, res) => {
      try {
        const filter = { docType: 'notes' } // Use docType filter if provided
    
        const recentQuestions = await filesCollection.find(filter).sort({ createdTime: -1 }).limit(8).toArray();
        console.log("data found ", recentQuestions.length);
    
        res.json(recentQuestions);
      } catch (error) {
        console.error('Error fetching recent questions:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
    //get recent question file api 
    app.get('/recent-slides', async (req, res) => {
      try {
        const filter = { docType: 'slides' } // Use docType filter if provided
    
        const recentQuestions = await filesCollection.find(filter).sort({ createdTime: -1 }).limit(8).toArray();
        console.log("data found ", recentQuestions.length);
    
        res.json(recentQuestions);
      } catch (error) {
        console.error('Error fetching recent questions:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
    //get recent question file api 
    app.get('/recent-books', async (req, res) => {
      try {
        const filter = { docType: 'book' } // Use docType filter if provided
    
        const recentQuestions = await filesCollection.find(filter).sort({ createdTime: -1 }).limit(8).toArray();
        console.log("data found ", recentQuestions.length);
    
        res.json(recentQuestions);
      } catch (error) {
        console.error('Error fetching recent questions:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
    

//getting score data api

    app.get('/leader-board/all-contributor', async (req, res) => {
      try {
        const result = await scoresCollection.find().toArray();
    
        // Sort users by points in descending order
        const sortedUsers = result.sort((a, b) => b.points - a.points);
    
        // Find the current user's position
        const currentUserEmail = 'user@example.com'; // Replace with the actual email of the current user
        const currentUser = sortedUsers.findIndex(user => user.email === currentUserEmail);
    
        // Add position to each user
        const leaderboardData = sortedUsers.map((user, index) => ({
          ...user,
          position: index + 1,
        }));
    
        res.send({ leaderboardData, currentUserPosition: currentUser + 1 });
      } catch (error) {
        console.log('Error fetching leaderboard data:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
      }
    });



    //   app.post("/upload-file-to-google-drive", upload.single("file"), async (req, res) => {
    //     try {
    //       if (!req.file) {
    //         res.status(400).send("No file uploaded.");
    //         return;
    //       }

    //       const auth = authenticateGoogle();
    //       console.log('user is now authenticated...');
    //       console.log("file type:", req.file.mimetype, 'file original name: ', req.file.originalname);
    //       const response = await uploadToGoogleDrive(req.file, auth);
    //       res.status(200).json({ message: 'File uploaded successfully.', publicUrl: response.data.webContentLink });
    // } catch (err) {
    //       console.log(err);
    //       res.status(500).json({ error: "Internal Server Error", message: err.message });
    //     }
    //   });


    // uploading file to the google drive api----------------------------------------------------------------------------------
    app.post("/upload-file-to-google-drive", multer.single("file"), async (req, res) => {
      console.log('hitting the server......');
      try {
        if (!req.file) {
          res.status(400).send("No file uploaded.");
          return;
        }
        const auth = authenticateGoogle();
        console.log('google authenticated...')
        const responseData = await uploadToGoogleDrive(req.file, auth);
        console.log("console line 291:", responseData);

        // console.log("Response From server: ---> ", responseData, "Response.data: ", responseData?.data, "Response.data.id:", responseData?.data?.id)

        // If the upload was successful, you can send a custom success message
        if (responseData.id) {
          // && responseData.data.id
          console.log("Response: ", responseData);
          res.status(200).json({ message: 'File uploaded to Google Drive successfully.', data: responseData.data, id: responseData.id, name: responseData.name, webContentLink: responseData.webContentLink, webViewLink: responseData.webViewLink, thumbnailLink: responseData.thumbnailLink, createdTime: responseData.createdTime });
        } else {
          // Handle other scenarios or provide additional information in the response
          res.status(500).json({ error: 'Unexpected response from Google Drive API.' });
        }
      } catch (err) {
        console.log(err);
        // Handle errors and send an appropriate response
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
      }
    });

    // Getting file from the gogole drive ------------------------------------------------------------------------------------------------

    app.get('/list-files', async (req, res) => {
      console.log('in the getting files api.....');
      try {
        const auth = authenticateGoogle();
        console.log('google authenticated...')
        const files = await listFilesInGoogleDrive(auth);
        res.status(200).json(files);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
      }
    });



    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensure that the client will close when you finish/error
    // await client.close();
  }
}

run().catch(console.dir);

function generateAlphanumericUserId(length) {
  const alphanumericCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';
  let userId = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * alphanumericCharacters.length);
    userId += alphanumericCharacters[randomIndex];
  }

  return userId;
}

app.get('/', (req, res) => {
  res.send('scholarsRepository is running ');
});

app.listen(port, () => {
  console.log(`scholarsRepository server is running on port: ${port}`);
});
