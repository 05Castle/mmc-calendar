// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDmCGj5_xJ-z069gvWLRO4e-fBVHqEuEKo",
  authDomain: "mmc-calendar-d098c.firebaseapp.com",
  projectId: "mmc-calendar-d098c",
  storageBucket: "mmc-calendar-d098c.firebasestorage.app",
  messagingSenderId: "14711642608",
  appId: "1:14711642608:web:5d6297ee3215f06360e535",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
