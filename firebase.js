import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAnalytics, logEvent, isSupported } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-analytics.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, runTransaction, collection, onSnapshot, addDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, increment, getCountFromServer, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC8KM41dePCv17pp2cwkVtO_4Sh2m6Ryb4',
  authDomain: 'qodrati-app-5613c.firebaseapp.com',
  projectId: 'qodrati-app-5613c',
  storageBucket: 'qodrati-app-5613c.firebasestorage.app',
  messagingSenderId: '903270716756',
  appId: '1:903270716756:web:04639368c73b3ded0124c1',
  measurementId: 'G-VSZ9P3LBXD'
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let analytics = null;
try { if (await isSupported()) analytics = getAnalytics(app); } catch (e) { console.warn('Analytics unavailable in this context', e); }
let unsubscribers = [];
let syncReady = false;
let questionsReady = false, foldersReady = false;
// بصمة كل مستند محفوظ في السحابة (id -> signature)؛ نستخدمها لكتابة العناصر المتغيّرة فقط.
let cloudQuestionSigs = new Map(), cloudFolderSigs = new Map();
const COMMUNITY_PAGE_SIZE = 20;
let communityLimit = COMMUNITY_PAGE_SIZE;
let communityUnsub = null;
let syncQueue = Promise.resolve();
const stableStringify = value => {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
};
const docSignature = data => { const { updatedAt, ...rest } = data || {}; return stableStringify(rest); };
let currentUid = null;
let syncInitPromise = null;
const api = { ready: true, todayVisitors: null };
const usernameEmail = username => `${btoa(unescape(encodeURIComponent(username.trim().toLowerCase()))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}@qodrati-app-5613c.firebaseapp.com`;
const cleanUsername = username => username.trim().toLowerCase();
const userRef = uid => doc(db, 'users', uid);
const toMs = ts => (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : (typeof ts === 'number' ? ts : Date.now());
const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

api.boot = () => { /* onAuthStateChanged below controls the UI */ };
api.authWithUsername = async (username, password, gender) => {
  const normalized = cleanUsername(username);
  if (!/^[\p{L}\p{N}._-]{3,20}$/u.test(username.trim())) throw new Error('استخدم 3 إلى 20 حرفًا أو رقمًا أو نقطة أو شرطة في اسم المستخدم.');
  const email = usernameEmail(username);
  let credential;
  let didCreateProfile = false;
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (error.code !== 'auth/user-not-found' && error.code !== 'auth/invalid-credential') throw error;
    // بعض إعدادات Firebase تعيد invalid-credential للحساب غير الموجود أيضًا؛ نفحص فهرس اسم المستخدم قبل إنشاء الحساب.
    const nameCheck = await getDoc(doc(db, 'usernames', normalized));
    if (nameCheck.exists()) throw new Error('اسم المستخدم موجود بالفعل، وكلمة المرور غير صحيحة.');
    credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;
    try {
      await runTransaction(db, async tx => {
        const usernameRef = doc(db, 'usernames', normalized);
        const nameSnap = await tx.get(usernameRef);
        if (nameSnap.exists() && nameSnap.data().uid !== uid) throw new Error('اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.');
        tx.set(usernameRef, { uid, username: username.trim(), createdAt: serverTimestamp() });
        tx.set(userRef(uid), { uid, username: username.trim(), usernameLower: normalized, gender, role: 'student', weeklyPoints: 0, totalPoints: 0, points: 0, weekId: '', dailyStreak: 0, lastDailyDate: '', duelsWon: 0, joinedAt: new Date().toISOString(), createdAt: serverTimestamp() });
      });
      didCreateProfile = true;
    } catch (e) {
      await signOut(auth).catch(() => {});
      throw e;
    }
  }
  // Ensure profile exists for accounts created in a previous version.
  // Keep the profile and username index in one atomic transaction to satisfy getAfter() rules.
  const profileSnap = await getDoc(userRef(credential.user.uid));
  if (!profileSnap.exists()) {
    const uid = credential.user.uid;
    await runTransaction(db, async tx => {
      const usernameRef = doc(db, 'usernames', normalized);
      const nameSnap = await tx.get(usernameRef);
      if (nameSnap.exists() && nameSnap.data().uid !== uid) {
        throw new Error('اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.');
      }
      tx.set(usernameRef, { uid, username: username.trim(), createdAt: serverTimestamp() });
      tx.set(userRef(uid), { uid, username: username.trim(), usernameLower: normalized, gender, role: 'student', weeklyPoints: 0, totalPoints: 0, points: 0, weekId: '', dailyStreak: 0, lastDailyDate: '', duelsWon: 0, joinedAt: new Date().toISOString(), createdAt: serverTimestamp() });
    });
    didCreateProfile = true;
  }
  if (didCreateProfile) {
    await setDoc(doc(db, 'analyticsCounters', 'main'), { usersRegistered: increment(1), updatedAt: serverTimestamp() }, { merge: true }).catch(console.warn);
    const freshProfile = (await getDoc(userRef(credential.user.uid))).data();
    window.onFirebaseUserChanged?.({ uid: credential.user.uid, username: freshProfile.username, gender: freshProfile.gender || gender, role: freshProfile.role || 'student', joinedAt: freshProfile.joinedAt || null, weeklyPoints: Number(freshProfile.weeklyPoints) || 0, totalPoints: Number(freshProfile.totalPoints ?? freshProfile.points) || 0, points: Number(freshProfile.totalPoints ?? freshProfile.points) || 0, weekId: freshProfile.weekId || '', dailyStreak: Number(freshProfile.dailyStreak) || 0, lastDailyDate: freshProfile.lastDailyDate || '', banned: freshProfile.banned === true });
  }
  if (analytics) logEvent(analytics, 'login', { method: 'username_password' });
};
api.logout = () => signOut(auth);
api.getIdToken = async () => {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return null;
  return user.getIdToken();
};
api.stopSync = () => {
  unsubscribers.forEach(fn => fn()); unsubscribers = [];
  if (communityUnsub) { communityUnsub(); communityUnsub = null; }
  communityLimit = COMMUNITY_PAGE_SIZE;
  syncReady = false; questionsReady = false; foldersReady = false; currentUid = null; syncInitPromise = null;
  cloudQuestionSigs = new Map(); cloudFolderSigs = new Map();
  window.applyCloudQuizCount?.(0);
  window.resetNotificationState?.();
};
api.persistState = data => {
  if (!currentUid || !syncReady) return Promise.reject(new Error('بيانات الحساب لم تكتمل مزامنتها بعد. انتظر لحظات ثم حاول مرة أخرى.'));
  const uid = currentUid;
  // فشل عملية سابقة لا يجب أن يوقف كل عمليات الحفظ اللاحقة.
  const operation = syncQueue.catch(() => {}).then(async () => {
    if (uid !== currentUid || !syncReady) throw new Error('تغير الحساب قبل اكتمال الحفظ. أعد المحاولة.');
    // نكتب فقط المستندات الجديدة أو المتغيّرة، ونحذف المستندات التي اختفت من الحالة الحالية.
    const syncCollection = async (collectionName, items, sigMap) => {
      const previous = new Map(sigMap);
      const next = new Map();
      for (const item of items) {
        const id = String(item.id);
        const sig = docSignature(item);
        next.set(id, sig);
        if (previous.get(id) === sig) continue; // لم يتغيّر، لا حاجة للكتابة
        // كل عنصر في مستند مستقل لتجنب حدّ Firestore البالغ 1MiB للمستند الواحد.
        await setDoc(doc(db, 'users', uid, collectionName, id), { ...item, updatedAt: serverTimestamp() });
        sigMap.set(id, sig);
      }
      for (const oldId of previous.keys()) {
        if (!next.has(oldId)) { await deleteDoc(doc(db, 'users', uid, collectionName, oldId)); sigMap.delete(oldId); }
      }
    };
    await syncCollection('questions', data.questions, cloudQuestionSigs);
    await syncCollection('folders', data.folders, cloudFolderSigs);
  });
  syncQueue = operation;
  return operation;
};
// Free-tier mode: images are compressed and stored as data URLs inside Firestore documents.
// Keep each image small to stay well below Firestore's 1 MiB document limit.
api.compressImageDataUrl = async (source, maxChars = 360000) => {
  const img = new Image();
  img.src = source;
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('تعذر قراءة الصورة.')); });
  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('متصفحك لا يدعم معالجة الصور.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let quality = 0.78;
  let result = canvas.toDataURL('image/jpeg', quality);
  while (result.length > maxChars && quality > 0.35) { quality -= 0.1; result = canvas.toDataURL('image/jpeg', quality); }
  while (result.length > maxChars && Math.max(canvas.width, canvas.height) > 420) {
    // تصغير متناسب يحافظ على نسبة أبعاد الصورة، مع إعادة الخلفية البيضاء بعد تغيير حجم canvas.
    const scaleDown = Math.max(420 / Math.max(canvas.width, canvas.height), 0.78);
    canvas.width = Math.max(1, Math.round(canvas.width * scaleDown));
    canvas.height = Math.max(1, Math.round(canvas.height * scaleDown));
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    quality = 0.48; result = canvas.toDataURL('image/jpeg', quality);
  }
  if (result.length > maxChars) throw new Error('الصورة كبيرة حتى بعد الضغط. جرّب صورة أصغر.');
  return result;
};
api.uploadFile = async (file, path) => {
  if (!file.type.startsWith('image/')) throw new Error('يُسمح برفع الصور فقط.');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('تعذرت قراءة الملف.')); reader.readAsDataURL(file);
  });
  const compressed = await api.compressImageDataUrl(dataUrl);
  if (analytics) logEvent(analytics, 'file_upload', { file_type: 'image', storage: 'firestore_data_url' });
  await api.recordUpload();
  return compressed;
};
api.uploadDataUrl = async (dataUrl, path) => {
  const compressed = await api.compressImageDataUrl(dataUrl);
  if (analytics) logEvent(analytics, 'file_upload', { file_type: 'image', storage: 'firestore_data_url' });
  await api.recordUpload();
  return compressed;
};
api.recordUpload = async () => {
  if (!currentUid) return;
  const date = dayKey();
  await Promise.all([
    setDoc(doc(db, 'analyticsDaily', date), { date, imageUploads: increment(1), updatedAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(db, 'analyticsCounters', 'main'), { uploadedImages: increment(1), updatedAt: serverTimestamp() }, { merge: true })
  ]);
};
api.recordQuestionAdded = async () => {
  if (!currentUid) return;
  await setDoc(doc(db, 'analyticsCounters', 'main'), { questionsAdded: increment(1), updatedAt: serverTimestamp() }, { merge: true });
};
function getDailyBrowserVisitorId(date) {
  // نفس المتصفح يُحسب مرة واحدة يوميًا حتى لو سجّل المستخدم الدخول بعد زيارة صفحة الدخول.
  const key = `qodrati_visitor_${date}`;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() || `v_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `session_${date}_${Math.random().toString(36).slice(2)}`;
  }
}
function renderVisitorCount() {
  if (api.todayVisitors == null) return;
  const el = document.getElementById('adminVisitorCount');
  if (el && document.getElementById('adminVisitorStats') && !document.getElementById('adminVisitorStats').classList.contains('hidden')) {
    el.textContent = String(api.todayVisitors);
  }
}
api.recordVisit = async (loadAdminCount = false) => {
  const date = dayKey();
  const visitorId = getDailyBrowserVisitorId(date);
  const visitorRef = doc(db, 'analyticsDaily', date, 'visitors', visitorId);
  await setDoc(visitorRef, { visitorId, lastSeenAt: serverTimestamp() }, { merge: true });
  // Only an admin fetches the aggregate count; ordinary/anonymous visitors only record their own daily visit.
  if (loadAdminCount) {
    const snap = await getCountFromServer(collection(db, 'analyticsDaily', date, 'visitors'));
    api.todayVisitors = snap.data().count;
    renderVisitorCount();
  }
  if (analytics) logEvent(analytics, 'daily_visitor');
};
api.createPost = async post => {
  const id = String(post.id);
  await setDoc(doc(db, 'communityPosts', id), { ...post, createdAt: serverTimestamp() });
  if (analytics) logEvent(analytics, 'community_post_created');
};
api.deletePost = async id => deleteDoc(doc(db, 'communityPosts', String(id)));
api.toggleLike = async (id, uid, liked) => updateDoc(doc(db, 'communityPosts', String(id)), { likes: liked ? arrayRemove(uid) : arrayUnion(uid), updatedAt: serverTimestamp() });
api.addReply = async (id, reply) => updateDoc(doc(db, 'communityPosts', String(id)), { replies: arrayUnion(reply), updatedAt: serverTimestamp() });
// عدّاد الاختبارات المنتهية، محفوظ في users/{uid}/appMeta/stats (قاعدة appMeta تسمح لصاحب الحساب).
api.recordQuizCompleted = async () => {
  if (!currentUid) return;
  await setDoc(doc(db, 'users', currentUid, 'appMeta', 'stats'), { quizzesTaken: increment(1), updatedAt: serverTimestamp() }, { merge: true });
};
// بلاغ واحد لكل مستخدم على كل منشور أو رد:
//   منشور: postId_uid      |      رد: postId_replyId_uid
api.reportPost = async (postId, replyId, reason) => {
  if (!currentUid) throw new Error('سجّل الدخول أولًا.');
  const pid = String(postId);
  const data = { postId: pid, reason: String(reason || 'سبب آخر').slice(0, 40), reporterUid: currentUid, createdAt: serverTimestamp() };
  let id = `${pid}_${currentUid}`;
  if (replyId != null && replyId !== '') { data.replyId = String(replyId); id = `${pid}_${data.replyId}_${currentUid}`; }
  await setDoc(doc(db, 'reports', id), data);
};
api.dismissReports = ids => Promise.all(ids.map(id => deleteDoc(doc(db, 'reports', String(id)))));
api.getPost = async id => { const snap = await getDoc(doc(db, 'communityPosts', String(id))); return snap.exists() ? snap.data() : null; };
// حذف رد واحد (الأدمن فقط حسب الـ Rules)
api.removeReply = (postId, replyId) => runTransaction(db, async tx => {
  const ref = doc(db, 'communityPosts', String(postId));
  const snap = await tx.get(ref);
  if (!snap.exists()) return;
  const replies = (Array.isArray(snap.data().replies) ? snap.data().replies : []).filter(r => String(r.id) !== String(replyId));
  tx.update(ref, { replies, updatedAt: serverTimestamp() });
});
// حظر وفك حظر مستخدم (الأدمن فقط حسب الـ Rules)
api.getUserBanned = async uid => { const snap = await getDoc(userRef(uid)); return snap.exists() && snap.data().banned === true; };
api.setBanned = (uid, flag) => updateDoc(userRef(uid), { banned: !!flag });
api.updateGamificationStats = ({ weekId, weeklyPoints, totalPoints, dailyStreak, lastDailyDate, duelWon }) => {
  if (!currentUid) return Promise.resolve();
  const payload = {
    weekId: String(weekId || ''),
    weeklyPoints: Number(weeklyPoints) || 0,
    totalPoints: Number(totalPoints) || 0,
    points: Number(totalPoints) || 0,
    dailyStreak: Number(dailyStreak) || 0,
    lastDailyDate: String(lastDailyDate || '')
  };
  if (duelWon) payload.duelsWon = increment(1);
  return updateDoc(userRef(currentUid), payload);
};
api.getPermanentLeaderboard = async (maxRows = 25) => {
  const q = query(collection(db, 'users'), orderBy('totalPoints', 'desc'), limit(maxRows));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => (Number(u.totalPoints) || 0) > 0);
};
// إشعارات الأدمن لكل المستخدمين
api.sendAnnouncement = ({ title, body }) => addDoc(collection(db, 'notifications'), { title, body, authorUid: currentUid, createdAt: serverTimestamp() });
api.deleteAnnouncement = id => deleteDoc(doc(db, 'notifications', String(id)));
// آخر وقت رأى فيه المستخدم الإشعارات (محفوظ في حسابه فيظهر العداد صحيحًا على أي جهاز)
api.markNotificationsSeen = ms => setDoc(doc(db, 'users', currentUid, 'appMeta', 'notifState'), { seenAt: ms, updatedAt: serverTimestamp() }, { merge: true });
// المجتمع: نحمّل آخر 20 منشورًا فقط، وزر «عرض المزيد» يزيد الحد.
function subscribeCommunity(uid) {
  if (communityUnsub) { communityUnsub(); communityUnsub = null; }
  const q = query(collection(db, 'communityPosts'), orderBy('createdAt', 'desc'), limit(communityLimit));
  communityUnsub = onSnapshot(q, snap => {
    if (currentUid !== uid) return;
    window.applyCloudComments?.(snap.docs.map(d => d.data()), snap.size >= communityLimit);
  }, err => console.error('Community sync', err));
}
api.loadMorePosts = async () => {
  if (!currentUid) return;
  communityLimit += COMMUNITY_PAGE_SIZE;
  subscribeCommunity(currentUid);
};
api.startSync = async (uid, isAdminUser = false) => {
  if (currentUid === uid && syncReady) return;
  if (currentUid === uid && syncInitPromise) return syncInitPromise;
  api.stopSync(); currentUid = uid;
  let resolveInitialSync, rejectInitialSync;
  syncInitPromise = new Promise((resolve, reject) => { resolveInitialSync = resolve; rejectInitialSync = reject; });
  let initialSyncSettled = false;
  const qRef = collection(db, 'users', uid, 'questions');
  const fRef = collection(db, 'users', uid, 'folders');
  const seedQuestions = () => [
    { id: 1, num: 1, category: 'quant', folder: 'الأسئلة الصعبة', text: 'إذا كان س + ص = 10، و س - ص = 4، فما قيمة س^2 - ص^2؟', options: ['40', '14', '24', '60'], correctIndex: 0, explanation: 'باستخدام الفرق بين مربعين: (س² - ص²) = (س + ص)(س - ص) = 10 × 4 = 40', imageUrl: null },
    { id: 2, num: 1, category: 'verbal', folder: 'التناظر اللفظي', text: 'تناظر لفظي: شجرة : ثمرة', options: ['بقرة : حليب', 'شمس : ضوء', 'كتاب : صفحة', 'نار : دخان'], correctIndex: 0, explanation: 'الشجرة تنتج الثمرة، والبقرة تنتج الحليب.', imageUrl: null }
  ];
  const seedFolders = () => [
    { id: 'f1', name: 'الأسئلة الصعبة', category: 'quant' }, { id: 'f2', name: 'الأكثر تكراراً', category: 'quant' }, { id: 'f3', name: 'أسئلة محدّثة', category: 'quant' }, { id: 'f4', name: 'التناظر اللفظي', category: 'verbal' }, { id: 'f5', name: 'إكمال الجمل', category: 'verbal' }
  ];
  let qInitialDone = false, fInitialDone = false;
  unsubscribers.push(onSnapshot(qRef, async snap => {
    cloudQuestionSigs = new Map(snap.docs.map(d => [d.id, docSignature(d.data())]));
    if (!qInitialDone) {
      qInitialDone = true;
      if (snap.empty) {
        // سجل التهيئة يمنع إعادة إنشاء الأسئلة الافتراضية بعد أن يحذف المستخدم آخر سؤال.
        const markerRef = doc(db, 'users', uid, 'appMeta', 'questionSeedsV1');
        const shouldSeed = await runTransaction(db, async tx => {
          const marker = await tx.get(markerRef);
          if (marker.exists()) return false;
          tx.set(markerRef, { seededAt: serverTimestamp() });
          return true;
        });
        if (shouldSeed && currentUid === uid) {
          for (const item of seedQuestions()) await setDoc(doc(qRef, String(item.id)), item);
        } else {
          if (currentUid === uid) { window.applyCloudQuestions?.([]); questionsReady = true; maybeReady(); }
        }
        return;
      }
    }
    if (currentUid !== uid) return;
    window.applyCloudQuestions?.(snap.docs.map(d => d.data()).sort((a,b) => Number(a.num)-Number(b.num)));
    questionsReady = true; maybeReady();
  }, err => { console.error('Questions sync', err); if (!initialSyncSettled) { initialSyncSettled = true; rejectInitialSync(err); } }));
  unsubscribers.push(onSnapshot(fRef, async snap => {
    cloudFolderSigs = new Map(snap.docs.map(d => [d.id, docSignature(d.data())]));
    if (!fInitialDone) {
      fInitialDone = true;
      if (snap.empty) {
        // سجل مستقل للمجلدات الافتراضية؛ لا يعيدها التطبيق بعد حذفها لاحقًا.
        const markerRef = doc(db, 'users', uid, 'appMeta', 'folderSeedsV1');
        const shouldSeed = await runTransaction(db, async tx => {
          const marker = await tx.get(markerRef);
          if (marker.exists()) return false;
          tx.set(markerRef, { seededAt: serverTimestamp() });
          return true;
        });
        if (shouldSeed && currentUid === uid) {
          for (const item of seedFolders()) await setDoc(doc(fRef, String(item.id)), item);
        } else {
          if (currentUid === uid) { window.applyCloudFolders?.([]); foldersReady = true; maybeReady(); }
        }
        return;
      }
    }
    if (currentUid !== uid) return;
    window.applyCloudFolders?.(snap.docs.map(d => d.data()));
    foldersReady = true; maybeReady();
  }, err => { console.error('Folders sync', err); if (!initialSyncSettled) { initialSyncSettled = true; rejectInitialSync(err); } }));
  // عدّاد الاختبارات المحفوظ للمستخدم
  unsubscribers.push(onSnapshot(doc(db, 'users', uid, 'appMeta', 'stats'), snap => {
    if (currentUid !== uid) return;
    window.applyCloudQuizCount?.(snap.exists() ? snap.data().quizzesTaken : 0);
  }, err => console.warn('Quiz stats sync', err)));
  // المجتمع: آخر 20 منشورًا فقط
  communityLimit = COMMUNITY_PAGE_SIZE;
  subscribeCommunity(uid);
  // حالة الحظر الحية لحساب المستخدم نفسه
  unsubscribers.push(onSnapshot(userRef(uid), snap => {
    if (currentUid !== uid || !snap.exists()) return;
    window.applyCloudProfile?.({ banned: snap.data().banned === true, weeklyPoints: Number(snap.data().weeklyPoints) || 0, totalPoints: Number(snap.data().totalPoints ?? snap.data().points) || 0, weekId: snap.data().weekId || '', dailyStreak: Number(snap.data().dailyStreak) || 0, lastDailyDate: snap.data().lastDailyDate || '' });
  }, err => console.warn('Profile sync', err)));
  // آخر وقت قرأ فيه المستخدم الإشعارات
  unsubscribers.push(onSnapshot(doc(db, 'users', uid, 'appMeta', 'notifState'), snap => {
    if (currentUid !== uid) return;
    window.applyNotifSeen?.(snap.exists() ? Number(snap.data().seenAt) || 0 : 0);
  }, err => console.warn('Notification state sync', err)));
  // إشعارات الأدمن لكل المستخدمين (آخر 30)
  let notifFirstSnapshot = true;
  unsubscribers.push(onSnapshot(query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(30)), snap => {
    if (currentUid !== uid) return;
    const items = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAtMs: toMs(d.data().createdAt) }));
    window.applyCloudNotifications?.(items);
    if (!notifFirstSnapshot) {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'added' && !ch.doc.metadata.hasPendingWrites) window.onNewAnnouncement?.(items.find(i => i.id === ch.doc.id));
      });
    }
    notifFirstSnapshot = false;
  }, err => console.warn('Notifications sync', err)));
  // البلاغات: للأدمن فقط (الـ Rules تمنع غيره من القراءة)
  if (isAdminUser) {
    let reportsFirstSnapshot = true;
    unsubscribers.push(onSnapshot(collection(db, 'reports'), snap => {
      if (currentUid !== uid) return;
      const list = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAtMs: toMs(d.data().createdAt) }));
      window.applyCloudReportDocs?.(list);
      if (!reportsFirstSnapshot) {
        snap.docChanges().forEach(ch => {
          if (ch.type === 'added' && !ch.doc.metadata.hasPendingWrites) window.onNewReport?.({ id: ch.doc.id, ...ch.doc.data() });
        });
      }
      reportsFirstSnapshot = false;
    }, err => console.warn('Reports sync', err)));
  }
  function maybeReady() {
    if (!questionsReady || !foldersReady || currentUid !== uid) return;
    syncReady = true;
    window.updateDashboardStats?.();
    if (window.currentActiveTab === 'quant' || window.currentActiveTab === 'verbal') window.renderBankView?.();
    if (!initialSyncSettled) { initialSyncSettled = true; resolveInitialSync(); }
  }
  return syncInitPromise;
};

onAuthStateChanged(auth, async user => {
  if (!user) {
    api.stopSync();
    window.onFirebaseUserChanged?.(null);
    // جلسة مجهولة تسمح بإحصاء زوار صفحة الدخول قبل إنشاء حساب أو تسجيل الدخول.
    signInAnonymously(auth).catch(error => console.warn('Anonymous visitor tracking unavailable; enable Anonymous in Firebase Authentication.', error));
    return;
  }
  if (user.isAnonymous) {
    api.recordVisit().catch(error => console.warn('Could not record anonymous visitor. Check Firestore rules.', error));
    return;
  }
  try {
    const snap = await getDoc(userRef(user.uid));
    if (!snap.exists()) { return; } // التسجيل الجديد قد يكون ما زال يكتب ملفه الشخصي
    const data = snap.data();
    window.onFirebaseUserChanged?.({ uid: user.uid, username: data.username || user.email.split('@')[0], gender: data.gender || 'male', role: data.role || 'student', joinedAt: data.joinedAt || null, weeklyPoints: Number(data.weeklyPoints) || 0, totalPoints: Number(data.totalPoints ?? data.points) || 0, points: Number(data.totalPoints ?? data.points) || 0, weekId: data.weekId || '', dailyStreak: Number(data.dailyStreak) || 0, lastDailyDate: data.lastDailyDate || '', banned: data.banned === true });
  } catch (error) { console.error(error); }
});
window.firebaseAPI = api;
window.firebaseReady = Promise.resolve(api);
