import * as admin from 'firebase-admin';

// Initialize Firebase Admin (The Server-Side SDK)
// We check 'apps.length' to ensure we don't initialize it twice in hot-reload environments
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel environment variables often mess up newlines, so we replace them back
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    })
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Get the Authorization Token (The "ID Badge") from the header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // 3. Verify the token securely with Firebase
    // This ensures the request actually came from a logged-in user, not a hacker script
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const { courses } = req.body;

    // 4. Write to the database securely
    // We strictly force the document ID to be the user's UID.
    // This makes it impossible for User A to overwrite User B's data.
    await db.collection('users').doc(uid).set({ courses }, { merge: true });

    return res.status(200).json({ success: true, message: 'Courses saved successfully' });

  } catch (error) {
    console.error('Error saving courses:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}
