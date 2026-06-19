// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCFg_3CtoVvcRlrMQ1fr72uvb1wTo1Xd_E",
  authDomain:        "jogos-com-eles.firebaseapp.com",
  projectId:         "jogos-com-eles",
  storageBucket:     "jogos-com-eles.firebasestorage.app",
  messagingSenderId: "968401638253",
  appId:             "1:968401638253:web:705d4107a2701d53984064"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
