// 1. Go to https://console.firebase.google.com, create a free project.
// 2. In Project settings > General > Your apps, add a "Web app" and copy the config it gives you here.
// 3. In Build > Authentication > Sign-in method, enable "Email/Password".
// 4. In Build > Firestore Database, click "Create database" (start in production mode),
//    then paste the rules from firestore.rules into the Rules tab.

const firebaseConfig = {
  apiKey: "AIzaSyABgBxC2v9Xbq9sjuc0QuWYAa0FqhKWTVY",
  authDomain: "the-nps-files.firebaseapp.com",
  projectId: "the-nps-files",
  storageBucket: "the-nps-files.firebasestorage.app",
  messagingSenderId: "611845476445",
  appId: "1:611845476445:web:9cdb7c16bde75f17b4bdb4"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
