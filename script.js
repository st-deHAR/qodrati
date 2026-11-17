        /* ===================================================
           STATE MANAGEMENT
        =================================================== */
        let currentUser = null; // Firebase Authentication هو مصدر الجلسة الموثوق
        let questions = [
            {
                id: 1,
                num: 1,
                category: 'quant',
                folder: 'الأسئلة الصعبة',
                text: 'إذا كان س + ص = 10، و س - ص = 4، فما قيمة س^2 - ص^2؟',
                options: ['40', '14', '24', '60'],
                correctIndex: 0,
                explanation: 'باستخدام الفرق بين مربعين: (س^2 - ص^2) = (س + ص)(س - ص) = 10 * 4 = 40',
                imageUrl: null
            },
            {
                id: 2,
                num: 2,
                category: 'verbal',
                folder: 'التناظر اللفظي',
                text: 'تناظر لفظي: شجرة : ثمرة',
                options: ['بقرة : حليب', 'شمس : ضوء', 'كتاب : صفحة', 'نار : دخان'],
                correctIndex: 0,
                explanation: 'الشجرة تنتج الثمرة، والبقرة تنتج الحليب (علاقة إنتاج/مصدر).',
                imageUrl: null
            }
        ];
        let folders = [
            { id: 'f1', name: 'الأسئلة الصعبة', category: 'quant' },
            { id: 'f2', name: 'الأكثر تكراراً', category: 'quant' },
            { id: 'f3', name: 'أسئلة محدّثة', category: 'quant' },
            { id: 'f4', name: 'التناظر اللفظي', category: 'verbal' },
            { id: 'f5', name: 'إكمال الجمل', category: 'verbal' }
        ];
        
        let comments = [];

        let currentActiveTab = 'dashboard';
        let currentBankCategory = 'quant';
        let activeFolderFilter = 'all';
        let currentOcrImageBase64 = null;
        let activePdfFileName = '';
        let extractedPdfQuestions = [];

        // Replace this URL with the public URL of the separate API server, including /api.
        const QODRATI_API_BASE_URL = window.QODRATI_API_BASE_URL || 'https://qodrati.onrender.com/api';

        // Community state
        let communityHasMore = false;
        let reportCountsPost = {};   // postId -> عدد البلاغات (للأدمن فقط)
        let reportCountsReply = {};  // postId:replyId -> عدد البلاغات (للأدمن فقط)
        let reportDocs = [];         // كل البلاغات المفتوحة (للأدمن فقط)
        const reportPostCache = new Map();

        // Notifications state
        let notifications = [];
        let notifSeenAt = 0;
        let notifSeenLoaded = false;
        let notifUnreadBefore = 0;
        let notifTab = 'inbox';

        // PDF State
        let pdfDoc = null;
        let pdfPageNum = 1;
        let pdfScale = 1.2;
        let pdfRenderTask = null;
        let pdfRenderToken = 0;

        // Quiz State
        let activeQuizQuestions = [];
        let currentQuizIndex = 0;
        let quizScore = 0;
        let answeredQuizIndices = new Set();
        let quizTimerInterval = null;
        let quizFinished = false;

        /* ===================================================
           INITIALIZATION & AUTH
        =================================================== */
        window.onload = function() {
            switchTab('auth');
            if (window.firebaseReady) window.firebaseReady.then(() => window.firebaseAPI?.boot()).catch(showFirebaseError);
            else setTimeout(() => window.firebaseAPI?.boot(), 0);
        };

        function showFirebaseError(error) {
            console.error('Firebase:', error);
            const message = error?.message || 'تعذر الاتصال بخدمات Firebase. تأكد من إعداد المشروع وقواعد الأمان.';
            alert('مشكلة في الاتصال بفايربيس: ' + message);
        }

        function saveStateToStorage() {
            // لا نضع بيانات الحسابات أو الصور في localStorage. نرجع Promise حتى لا تعتبر الواجهة الحفظ ناجحًا قبل تأكيد Firestore.
            if (!currentUser?.uid || !window.firebaseAPI?.ready) return Promise.reject(new Error('لم يكتمل تسجيل الدخول إلى Firebase.'));
            return window.firebaseAPI.persistState({ questions: [...questions], folders: [...folders] });
        }
        window.applyCloudQuestions = function(items) { questions = Array.isArray(items) ? items : []; updateDashboardStats(); if (currentActiveTab === 'quant' || currentActiveTab === 'verbal') renderBankView(); };
        window.applyCloudFolders = function(items) { folders = Array.isArray(items) ? items : []; updateDashboardStats(); updateFolderOptionsInModal(); updateQuizFolderOptions(); if (currentActiveTab === 'quant' || currentActiveTab === 'verbal') renderBankView(); };
        window.applyCloudComments = function(items, hasMore) {
            comments = Array.isArray(items) ? items : [];
            communityHasMore = !!hasMore;
            if (currentActiveTab === 'community') renderCommunityComments();
            if (typeof isModalOpen === 'function' && isModalOpen('repliesModal')) renderRepliesModal(false);
        };
        window.applyCloudProfile = function(patch) {
            if (!currentUser || !patch) return;
            const wasBanned = !!currentUser.banned;
            currentUser.banned = !!patch.banned;
            if (typeof patch.weeklyPoints === 'number') currentUser.weeklyPoints = patch.weeklyPoints;
            if (typeof patch.totalPoints === 'number') { currentUser.totalPoints = patch.totalPoints; currentUser.points = patch.totalPoints; }
            if (typeof patch.weekId === 'string') currentUser.weekId = patch.weekId;
            if (typeof patch.dailyStreak === 'number') currentUser.dailyStreak = patch.dailyStreak;
            if (typeof patch.lastDailyDate === 'string') currentUser.lastDailyDate = patch.lastDailyDate;
            syncGamificationUI();
            if (currentUser.banned && !wasBanned) alert('تم إيقاف مشاركتك في المجتمع من قِبل الإدارة. يمكنك الاستمرار في استخدام بنك أسئلتك الخاص.');
        };
        window.applyCloudQuizCount = function(n) {
            const el = document.getElementById('statQuizCount');
            if (el) el.textContent = String(Number(n) || 0);
        };

        async function handleAuth(e) {
            e.preventDefault();
            const username = document.getElementById('usernameInput').value.trim();
            const password = document.getElementById('passwordInput').value;
            const gender = document.querySelector('input[name="gender"]:checked').value;
            if (!username || !password.trim()) return alert('اكتب اسم المستخدم وكلمة المرور.');
            if (username.length < 3 || username.length > 20 || password.length < 6) return alert('اسم المستخدم من 3 إلى 20 حرفًا، وكلمة المرور 6 أحرف على الأقل.');
            const submit = document.querySelector('#authForm button[type="submit"]');
            if (submit) { submit.disabled = true; submit.dataset.originalText ||= submit.innerHTML; submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ الاتصال...'; }
            try {
                if (!window.firebaseReady) throw new Error('جارٍ تحميل خدمات Firebase، حاول مرة أخرى بعد لحظات.');
                await window.firebaseReady;
                await window.firebaseAPI.authWithUsername(username, password, gender);
                // onAuthStateChanged سيحمّل الملف الشخصي والبيانات ويعرض الواجهة.
            } catch (error) {
                console.error(error);
                const friendly = ({
                    'auth/configuration-not-found': 'فعّل Email/Password من Firebase Console > Authentication > Sign-in method.',
                    'auth/operation-not-allowed': 'فعّل مزوّد Email/Password من Firebase Console > Authentication.',
                    'auth/email-already-in-use': 'اسم المستخدم مستخدم بالفعل. جرّب تسجيل الدخول بكلمة المرور الصحيحة.',
                    'auth/invalid-credential': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
                    'auth/weak-password': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.',
                    'permission-denied': 'قواعد Firestore لا تسمح بالعملية. استخدم ملفات القواعد المرفقة وانشرها في Firebase Console.'
                })[error?.code] || error?.message || 'حصل خطأ أثناء تسجيل الدخول أو إنشاء الحساب.';
                alert(friendly);
            } finally {
                if (submit) { submit.disabled = false; submit.innerHTML = submit.dataset.originalText || 'الدخول إلى المنصة'; }
            }
        }

        function applyTheme(gender) {
            const root = document.documentElement;
            if (gender === 'female') {
                root.classList.remove('theme-male');
                root.classList.add('theme-female');
            } else {
                root.classList.remove('theme-female');
                root.classList.add('theme-male');
            }
        }

        function showMainInterface() {
            if (!currentUser) return;
            isGuestMode = false;
            document.getElementById('view-auth').classList.add('hidden');
            document.getElementById('navGuestArea')?.classList.add('hidden');
            document.getElementById('navGuestArea')?.classList.remove('flex');
            document.getElementById('guestSaveBanner')?.classList.add('hidden');
            document.getElementById('appNav').classList.remove('hidden');
            document.getElementById('navUserArea').classList.remove('hidden');
            document.getElementById('navUserArea').classList.add('flex');
            document.getElementById('navUserName').textContent = currentUser.username;
            const badge = document.getElementById('navGenderBadge');
            badge.textContent = currentUser.gender === 'female' ? 'طالبة (وردي)' : 'طالب (أزرق)';
            document.getElementById('dashUsername').textContent = currentUser.username;
            syncGamificationUI();
            switchTab('dashboard');
            updateDashboardStats();
            // Show welcome challenge toast/prompt upon logging in
            setTimeout(() => {
                showToast('أهلاً بك مجدداً يا بطل! ⚡', 'جاهز لمبارزة سريعة وتجميع النقاط؟ انتقل للتحدي الآن!');
            }, 800);
        }

        async function logout() {
            try { await window.firebaseAPI?.logout(); }
            catch (error) { console.error(error); alert('تعذر تسجيل الخروج من Firebase.'); }
        }

        // يستدعيها Firebase بعد التأكد من هوية المستخدم وتحميل ملفه الشخصي.
        window.onFirebaseUserChanged = async function(profile) {
            if (!profile) {
                currentUser = null;
                window.firebaseAPI?.stopSync();
                resetNotificationState();
                if (!isGuestMode) {
                    document.getElementById('appNav').classList.add('hidden');
                    document.getElementById('navUserArea').classList.add('hidden');
                    document.getElementById('navGuestArea')?.classList.remove('hidden');
                    document.getElementById('navGuestArea')?.classList.add('flex');
                    document.getElementById('view-auth').classList.remove('hidden');
                    hideAllViews();
                }
                syncGamificationUI();
                return;
            }
            currentUser = profile;
            const adminVisitorStats = document.getElementById('adminVisitorStats');
            if (adminVisitorStats) adminVisitorStats.classList.toggle('hidden', profile.role !== 'admin');
            applyTheme(profile.gender || 'male');
            try {
                await window.firebaseAPI.startSync(profile.uid, profile.role === 'admin');
            } catch (error) {
                console.error('Initial Firestore sync failed:', error);
                showFirebaseError(error);
                return;
            }
            // Merge any temporary guest points earned before logging in
            const guestData = getGuestState();
            if (guestData.totalPoints > 0) {
                const bonus = guestData.totalPoints;
                clearGuestState();
                await awardGamificationPoints(bonus, { duelWon: false });
                showToast('تم حفظ نقاطك! 🎉', `تمت إضافة +${bonus} نقطة جمعتها قبل تسجيل الدخول إلى حسابك.`);
            }
            showMainInterface();
            updateBell();
            if (currentActiveTab === 'community') renderCommunityComments();
            // سجّل الزيارة باستخدام معرّف المتصفح/اليوم نفسه، وليس UID الحساب، لتجنب العد المكرر بعد تسجيل الدخول.
            window.firebaseAPI.recordVisit(profile.role === 'admin').catch(console.error);
        };

        /* ===================================================
           TAB NAVIGATION
        =================================================== */
        function hideAllViews() {
            ['dashboard', 'challenge', 'league', 'bank', 'pdf', 'quiz', 'community'].forEach(v => {
                const el = document.getElementById(`view-${v}`);
                if (el) el.classList.add('hidden');
            });
        }

        function switchTab(tab) {
            if (!currentUser && tab !== 'auth') {
                if (tab === 'challenge' || tab === 'league') {
                    isGuestMode = true;
                    document.getElementById('view-auth').classList.add('hidden');
                    document.getElementById('appNav').classList.remove('hidden');
                    document.getElementById('guestSaveBanner')?.classList.remove('hidden');
                } else {
                    alert('سجّل الدخول أو أنشئ حساباً مجانياً للوصول إلى بنوك الأسئلة والمجتمع.');
                    openAuthFromGuest();
                    return;
                }
            } else if (currentUser && tab !== 'auth') {
                document.getElementById('view-auth').classList.add('hidden');
            }
            // لا نحتفظ بفلتر مجلد من القسم الكمي عند الانتقال إلى اللفظي أو العكس.
            if ((tab === 'quant' || tab === 'verbal') && tab !== currentActiveTab) activeFolderFilter = 'all';
            currentActiveTab = tab;
            hideAllViews();

            // Update tab buttons highlighting
            document.querySelectorAll('.nav-tab').forEach(b => {
                b.classList.remove('bg-sky-600', 'bg-pink-600', 'text-white');
            });

            const activeBtn = document.getElementById(`tab-${tab}`);
            if (activeBtn) {
                const bgClass = currentUser?.gender === 'female' ? 'bg-pink-600' : 'bg-sky-600';
                activeBtn.classList.add(bgClass, 'text-white');
            }

            if (tab === 'dashboard') {
                document.getElementById('view-dashboard').classList.remove('hidden');
                updateDashboardStats();
            } else if (tab === 'quant') {
                currentBankCategory = 'quant';
                document.getElementById('view-bank').classList.remove('hidden');
                renderBankView();
            } else if (tab === 'verbal') {
                currentBankCategory = 'verbal';
                document.getElementById('view-bank').classList.remove('hidden');
                renderBankView();
            } else if (tab === 'pdf') {
                document.getElementById('view-pdf').classList.remove('hidden');
            } else if (tab === 'quiz') {
                document.getElementById('view-quiz').classList.remove('hidden');
                resetQuizSetup();
            } else if (tab === 'challenge') {
                document.getElementById('view-challenge').classList.remove('hidden');
                syncGamificationUI();
            } else if (tab === 'league') {
                document.getElementById('view-league').classList.remove('hidden');
                refreshPermanentLeague();
            } else if (tab === 'community') {
                document.getElementById('view-community').classList.remove('hidden');
                renderCommunityComments();
            }
        }

        // Escape any user-provided text before placing it in an HTML template.
        function escapeHTML(value) {
            return String(value ?? '').replace(/[&<>"']/g, ch => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[ch]));
        }

        // Only allow image data URLs and http(s) URLs in image src attributes.
        function safeImageSource(value) {
            const url = String(value ?? '').trim();
            if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(url)) return url;
            try {
                const parsed = new URL(url, window.location.href);
                return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
            } catch (_) {
                return '';
            }
        }

        /* ===================================================
           DASHBOARD & STATS
        =================================================== */
        function updateDashboardStats() {
            const quantCount = questions.filter(q => q.category === 'quant').length;
            const verbalCount = questions.filter(q => q.category === 'verbal').length;
            
            document.getElementById('statQuantCount').textContent = quantCount;
            document.getElementById('statVerbalCount').textContent = verbalCount;
            document.getElementById('statFolderCount').textContent = folders.length;

            const list = document.getElementById('latestQuestionsList');
            list.innerHTML = '';
            
            const recent = questions.slice(-4).reverse();
            if (recent.length === 0) {
                list.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">لا توجد أسئلة مضافة بعد.</p>`;
                return;
            }

            recent.forEach(q => {
                const item = document.createElement('div');
                item.className = 'p-2.5 bg-slate-900/70 border border-slate-800 rounded-xl text-xs flex justify-between items-center';
                item.innerHTML = `
                    <div class="truncate max-w-[200px]">
                        <span class="font-bold text-accent">#${escapeHTML(q.num)}</span> ${escapeHTML(q.text)}
                    </div>
                    <span class="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">${q.category === 'quant' ? 'كمي' : 'لفظي'}</span>
                `;
                list.appendChild(item);
            });
        }

        /* ===================================================
           QUESTION BANK & FOLDER SYSTEM
        =================================================== */
        function renderBankView() {
            const titleEl = document.getElementById('bankTitle');
            titleEl.innerHTML = currentBankCategory === 'quant' 
                ? `<i class="fa-solid fa-calculator text-sky-400"></i> القسم الكمي`
                : `<i class="fa-solid fa-book-open text-pink-400"></i> القسم اللفظي`;

            // Render Folder Badges Filter
            const badgeContainer = document.getElementById('folderBadgesList');
            badgeContainer.innerHTML = '';

            const catFolders = folders.filter(f => f.category === currentBankCategory);
            
            // All Badge
            const allBtn = document.createElement('button');
            allBtn.className = `px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${activeFolderFilter === 'all' ? 'btn-primary' : 'bg-slate-800 text-slate-300'}`;
            allBtn.textContent = 'الكل';
            allBtn.onclick = () => { activeFolderFilter = 'all'; renderBankView(); };
            badgeContainer.appendChild(allBtn);

            catFolders.forEach(f => {
                const b = document.createElement('button');
                b.className = `px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${activeFolderFilter === f.name ? 'btn-primary' : 'bg-slate-800 text-slate-300'}`;
                b.textContent = f.name;
                b.onclick = () => { activeFolderFilter = f.name; renderBankView(); };
                badgeContainer.appendChild(b);
            });

            // Render Questions
            const qContainer = document.getElementById('questionsContainer');
            qContainer.innerHTML = '';

            let filtered = questions.filter(q => q.category === currentBankCategory);
            if (activeFolderFilter !== 'all') {
                filtered = filtered.filter(q => q.folder === activeFolderFilter);
            }

            if (filtered.length === 0) {
                qContainer.innerHTML = `
                    <div class="col-span-full text-center py-12 text-slate-500 custom-card rounded-2xl">
                        <i class="fa-solid fa-folder-open text-4xl mb-2"></i>
                        <p class="text-sm font-semibold">لا توجد أسئلة مخزنة في هذا المجلد حتى الآن.</p>
                    </div>
                `;
                return;
            }

            filtered.forEach(q => {
                const card = document.createElement('div');
                card.className = 'custom-card p-5 rounded-2xl space-y-3 relative group';
                
                const optionsHTML = (Array.isArray(q.options) ? q.options : []).map((opt, idx) => `
                    <div class="p-2 rounded-lg border text-xs flex justify-between items-center ${idx === q.correctIndex ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300 font-bold' : 'bg-slate-900/50 border-slate-800'}">
                        <span>${['أ', 'ب', 'ج', 'د'][idx]} - ${escapeHTML(opt)}</span>
                        ${idx === q.correctIndex ? '<i class="fa-solid fa-check text-emerald-400"></i>' : ''}
                    </div>
                `).join('');

                card.innerHTML = `
                    <div class="flex justify-between items-start gap-2">
                        <div class="flex items-center gap-2">
                            <span class="w-7 h-7 rounded-lg bg-slate-800 text-accent font-bold flex items-center justify-center text-xs">#${escapeHTML(q.num)}</span>
                            <span class="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-amber-400 font-semibold">${escapeHTML(q.folder || 'عام')}</span>
                        </div>
                        <button data-delete-question="${escapeHTML(q.id)}" title="حذف السؤال" class="text-slate-500 hover:text-red-400 text-xs">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>

                    ${safeImageSource(q.imageUrl) ? `<img src="${escapeHTML(safeImageSource(q.imageUrl))}" alt="صورة السؤال" class="max-h-40 rounded-xl border border-slate-700 mx-auto my-2" loading="lazy">` : ''}

                    <p class="font-bold text-sm leading-relaxed whitespace-pre-wrap">${escapeHTML(q.text)}</p>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        ${optionsHTML}
                    </div>

                    ${q.explanation ? `
                        <div class="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 text-[11px] text-slate-300">
                            <span class="font-bold text-accent"><i class="fa-solid fa-lightbulb"></i> الشرح:</span> ${escapeHTML(q.explanation)}
                        </div>
                    ` : ''}
                `;
                const deleteButton = card.querySelector('[data-delete-question]');
                if (deleteButton) deleteButton.addEventListener('click', () => deleteQuestion(q.id));
                qContainer.appendChild(card);
            });
        }

        async function deleteQuestion(id) {
            const previousQuestions = questions;
            questions = questions.filter(q => String(q.id) !== String(id));
            renderBankView();
            updateDashboardStats();
            try {
                await saveStateToStorage();
            } catch (error) {
                questions = previousQuestions;
                renderBankView();
                updateDashboardStats();
                showFirebaseError(error);
            }
        }

        /* ===================================================
           MODALS & ADD QUESTION WITH OCR
        =================================================== */
        function openCreateFolderModal() {
            document.getElementById('folderModal').classList.remove('hidden');
        }
        function closeFolderModal() {
            document.getElementById('folderModal').classList.add('hidden');
        }

        async function saveNewFolder() {
            const name = document.getElementById('folderNameInput').value.trim();
            const category = document.getElementById('folderCategorySelect').value;
            if (!name) return alert('اكتب اسم المجلد أولًا.');
            if (folders.some(f => f.category === category && f.name.trim().toLowerCase() === name.toLowerCase())) return alert('يوجد مجلد بالاسم نفسه في هذا القسم.');

            const previousFolders = folders;
            folders = [...folders, { id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name, category }];
            renderBankView();
            updateFolderOptionsInModal();
            try {
                await saveStateToStorage();
                // اجعل المجلد الجديد متاحًا فورًا في قائمة مجلدات السؤال دون تحديث الصفحة.
                const questionCategory = document.getElementById('qCategorySelect');
                if (questionCategory) questionCategory.value = category;
                updateFolderOptionsInModal();
                updateQuizFolderOptions();
                closeFolderModal();
                document.getElementById('folderNameInput').value = '';
            } catch (error) {
                folders = previousFolders;
                renderBankView();
                updateFolderOptionsInModal();
                updateQuizFolderOptions();
                showFirebaseError(error);
            }
        }

        function openAddQuestionModal() {
            updateFolderOptionsInModal();
            document.getElementById('addQuestionModal').classList.remove('hidden');
        }
        function closeAddQuestionModal() {
            document.getElementById('addQuestionModal').classList.add('hidden');
            currentOcrImageBase64 = null;
        }

        function updateFolderOptionsInModal() {
            const cat = document.getElementById('qCategorySelect').value;
            const folderSelect = document.getElementById('qFolderSelect');
            folderSelect.innerHTML = '<option value="عام">عام / بدون مجلد</option>';

            const catFolders = folders.filter(f => f.category === cat);
            catFolders.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.name;
                opt.textContent = f.name;
                folderSelect.appendChild(opt);
            });
        }

        // Tesseract.js OCR engine implementation
        async function processOCRImage(event) {
            const file = event.target.files[0];
            if (!file) return;

            const statusEl = document.getElementById('ocrStatus');
            statusEl.classList.remove('hidden');

            // Convert to Base64 for rendering preview
            const reader = new FileReader();
            reader.onload = async function(e) {
                currentOcrImageBase64 = e.target.result;

                try {
                    // Perform OCR extraction (Arabic + English)
                    const worker = await Tesseract.createWorker('ara+eng');
                    const ret = await worker.recognize(e.target.result);
                    await worker.terminate();

                    const extractedText = ret.data.text.trim();
                    if (extractedText) {
                        document.getElementById('qTextInput').value = extractedText;
                    }
                } catch (err) {
                    console.error("OCR Error:", err);
                    alert('تعذر استخراج النص تلقائيًا من الصورة. تأكد من الاتصال بالإنترنت أو اكتب نص السؤال يدويًا.');
                } finally {
                    statusEl.classList.add('hidden');
                }
            };
            reader.readAsDataURL(file);
        }

        async function saveQuestion(e) {
            e.preventDefault();
            const category = document.getElementById('qCategorySelect').value;
            const folder = document.getElementById('qFolderSelect').value;
            const text = document.getElementById('qTextInput').value.trim();
            const options = [
                document.getElementById('choice0').value.trim(),
                document.getElementById('choice1').value.trim(),
                document.getElementById('choice2').value.trim(),
                document.getElementById('choice3').value.trim()
            ];
            const correctIndex = parseInt(document.querySelector('input[name="correctChoice"]:checked').value);
            const explanation = document.getElementById('qExplanationInput').value.trim();

            const categoryQuestions = questions.filter(q => q.category === category);
            const num = categoryQuestions.reduce((max, q) => Math.max(max, Number(q.num) || 0), 0) + 1;

            let imageUrl = currentOcrImageBase64;
            if (imageUrl && imageUrl.startsWith('data:')) {
                try { imageUrl = await window.firebaseAPI.uploadDataUrl(imageUrl, `users/${currentUser.uid}/questions/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`); }
                catch (error) { console.error(error); alert('تعذر تجهيز صورة السؤال وحفظها في Firestore. جرّب صورة أصغر وتأكد من قواعد Firestore.'); return; }
            }
            const newQ = { id: Date.now(), num, category, folder, text, options, correctIndex, explanation, imageUrl: imageUrl || null };
            const previousQuestions = questions;
            questions = [...questions, newQ];
            try {
                await saveStateToStorage();
            } catch (error) {
                questions = previousQuestions;
                renderBankView();
                updateDashboardStats();
                showFirebaseError(error);
                return;
            }
            window.firebaseAPI?.recordQuestionAdded().catch(console.error);
            closeAddQuestionModal();
            
            // Clear inputs
            document.getElementById('qTextInput').value = '';
            document.getElementById('choice0').value = '';
            document.getElementById('choice1').value = '';
            document.getElementById('choice2').value = '';
            document.getElementById('choice3').value = '';
            document.getElementById('qExplanationInput').value = '';

            if (currentActiveTab === 'quant' || currentActiveTab === 'verbal') {
                renderBankView();
            }
            updateDashboardStats();
        }

        /* ===================================================
           PDF VIEWER & QUICK NOTES
        =================================================== */
        async function loadPDF(e) {
            const file = e?.target?.files?.[0];
            if (!file) return;

            const fileName = document.getElementById('pdfFileName');
            const emptyState = document.getElementById('pdfEmptyState');
            const controls = document.getElementById('pdfControls');
            activePdfFileName = file.name;
            if (fileName) fileName.textContent = file.name;
            if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                alert('من فضلك اختر ملف PDF صالحًا.');
                e.target.value = '';
                return;
            }
            if (file.size > 50 * 1024 * 1024) {
                alert('حجم الملف أكبر من 50 ميجابايت. اختر ملفًا أصغر لتجنب بطء المتصفح.');
                e.target.value = '';
                return;
            }

            try {
                if (fileName) fileName.textContent = `جارٍ فتح: ${file.name}`;
                const buffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
                const pdf = await loadingTask.promise;
                pdfDoc = pdf;
                pdfPageNum = 1;
                pdfScale = 1.2;
                document.getElementById('pdfPageCount').textContent = String(pdf.numPages);
                document.getElementById('pdfImportPages').value = `1-${Math.min(pdf.numPages, 20)}`;
                if (controls) {
                    controls.classList.remove('hidden');
                    controls.classList.add('flex');
                }
                if (emptyState) emptyState.classList.add('hidden');
                if (fileName) fileName.textContent = file.name;
                await renderPDFPage();
            } catch (error) {
                console.error('PDF load error:', error);
                pdfDoc = null;
                if (controls) {
                    controls.classList.add('hidden');
                    controls.classList.remove('flex');
                }
                if (emptyState) emptyState.classList.remove('hidden');
                if (fileName) fileName.textContent = 'تعذر فتح الملف';
                alert('تعذر فتح ملف PDF. تأكد أن الملف غير تالف وأنه ملف PDF صحيح.');
            }
        }

        async function renderPDFPage() {
            if (!pdfDoc) return;
            // كل استدعاء جديد يلغي السابق، فلا يحدث تداخل عند الضغط السريع.
            const token = ++pdfRenderToken;
            if (pdfRenderTask) { try { pdfRenderTask.cancel(); } catch (_) {} pdfRenderTask = null; }
            try {
                const page = await pdfDoc.getPage(pdfPageNum);
                if (token !== pdfRenderToken) return;
                const canvas = document.getElementById('pdfCanvas');
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;
                const viewport = page.getViewport({ scale: pdfScale });
                canvas.height = Math.ceil(viewport.height);
                canvas.width = Math.ceil(viewport.width);
                const task = page.render({ canvasContext: ctx, viewport });
                pdfRenderTask = task;
                await task.promise;
                if (pdfRenderTask === task) pdfRenderTask = null;
                if (token === pdfRenderToken) document.getElementById('pdfPageNum').textContent = String(pdfPageNum);
            } catch (error) {
                if (error?.name === 'RenderingCancelledException') return;
                console.error('PDF page render error:', error);
                alert('حدث خطأ أثناء عرض الصفحة. جرّب تصغير التكبير أو إعادة فتح الملف.');
            }
        }

        function zoomInPDF() {
            if (!pdfDoc) return;
            pdfScale = Math.min(3, Math.round((pdfScale + 0.2) * 10) / 10);
            renderPDFPage();
        }

        function zoomOutPDF() {
            if (!pdfDoc) return;
            pdfScale = Math.max(0.5, Math.round((pdfScale - 0.2) * 10) / 10);
            renderPDFPage();
        }

        function prevPDFPage() {
            if (pdfPageNum <= 1) return;
            pdfPageNum--;
            renderPDFPage();
        }

        function nextPDFPage() {
            if (!pdfDoc || pdfPageNum >= pdfDoc.numPages) return;
            pdfPageNum++;
            renderPDFPage();
        }

        function setPDFExtractStatus(message, isError = false) {
            const status = document.getElementById('pdfExtractStatus');
            if (!status) return;
            status.textContent = message || '';
            status.classList.toggle('hidden', !message);
            status.classList.toggle('text-red-300', !!isError);
            status.classList.toggle('text-sky-300', !isError);
        }

        function parsePdfPageSelection(value, totalPages) {
            const raw = String(value || '').trim() || `1-${Math.min(totalPages, 20)}`;
            const selected = new Set();
            for (const part of raw.split(/[،,]/).map(item => item.trim()).filter(Boolean)) {
                const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
                if (!match) throw new Error('اكتب الصفحات بهذا الشكل: 1-8، 11، 14-16.');
                const start = Number(match[1]);
                const end = Number(match[2] || match[1]);
                if (start < 1 || end < start || end > totalPages) {
                    throw new Error(`رقم الصفحة يجب أن يكون بين 1 و${totalPages}.`);
                }
                for (let page = start; page <= end; page++) {
                    selected.add(page);
                    if (selected.size > 20) throw new Error('اختر 20 صفحة كحد أقصى في كل مرة.');
                }
            }
            if (!selected.size) throw new Error('حدد صفحة واحدة على الأقل.');
            return [...selected].sort((a, b) => a - b);
        }

        async function extractTextFromPDFPages(pageNumbers) {
            const pageParts = [];
            let ocrWorker = null;
            try {
                for (let i = 0; i < pageNumbers.length; i++) {
                    const pageNumber = pageNumbers[i];
                    setPDFExtractStatus(`قراءة الصفحة ${pageNumber} من ${pageNumbers.length}...`);
                    const page = await pdfDoc.getPage(pageNumber);
                    const content = await page.getTextContent();
                    let pageText = content.items
                        .map(item => {
                            const value = typeof item.str === 'string' ? item.str : '';
                            return value + (item.hasEOL ? '\n' : ' ');
                        })
                        .join('')
                        .trim();

                    // Scanned PDFs have no text layer, so OCR runs locally in the browser.
                    if (pageText.replace(/\s/g, '').length < 30) {
                        if (!ocrWorker) ocrWorker = await Tesseract.createWorker('ara+eng');
                        const originalViewport = page.getViewport({ scale: 1 });
                        const scale = Math.min(1.5, 1600 / Math.max(originalViewport.width, originalViewport.height));
                        const viewport = page.getViewport({ scale });
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.ceil(viewport.width));
                        canvas.height = Math.max(1, Math.ceil(viewport.height));
                        const context = canvas.getContext('2d');
                        if (!context) throw new Error('المتصفح لا يدعم قراءة صفحات PDF.');
                        await page.render({ canvasContext: context, viewport }).promise;
                        const recognized = await ocrWorker.recognize(canvas);
                        pageText = String(recognized.data.text || '').trim();
                        canvas.width = 1;
                        canvas.height = 1;
                    }

                    if (pageText) pageParts.push(`[صفحة PDF ${pageNumber}]\n${pageText}`);
                }
            } finally {
                if (ocrWorker) await ocrWorker.terminate();
            }
            return pageParts.join('\n\n');
        }

        async function extractQuestionWithAIFromPDF() {
            if (!pdfDoc) {
                alert('افتح ملف PDF أولاً.');
                return;
            }
            if (!currentUser?.uid || !window.firebaseAPI?.getIdToken) {
                alert('سجّل الدخول قبل استخراج الأسئلة.');
                return;
            }
            const button = document.getElementById('pdfAIExtractBtn');
            if (button) button.disabled = true;
            try {
                const pageNumbers = parsePdfPageSelection(
                    document.getElementById('pdfImportPages')?.value,
                    pdfDoc.numPages
                );
                const text = await extractTextFromPDFPages(pageNumbers);
                if (text.replace(/\s/g, '').length < 20) {
                    throw new Error('لم يظهر نص واضح في الصفحات المحددة. جرّب صفحات أوضح.');
                }
                if (text.length > 150000) {
                    throw new Error('النص طويل جدًا. اختر نطاق صفحات أصغر.');
                }
                const baseUrl = String(QODRATI_API_BASE_URL || '').replace(/\/+$/, '');
                if (!baseUrl || baseUrl.includes('YOUR-API-HOST')) {
                    throw new Error('ضع رابط خادم API المنشور في إعداد QODRATI_API_BASE_URL أعلى كود الصفحة.');
                }
                const idToken = await window.firebaseAPI.getIdToken();
                if (!idToken) throw new Error('انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.');

               setPDFExtractStatus('يراجع Gemini الأسئلة والاختيارات...');
const response = await fetch(`${baseUrl}/questions/extract`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        text,
        pageNumbers,
        sourceFileName: activePdfFileName || 'ملف PDF'
    })
}); 
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'تعذر تحليل الملف.');
                extractedPdfQuestions = Array.isArray(result.questions) ? result.questions : [];
                if (!extractedPdfQuestions.length) {
                    setPDFExtractStatus('لم نجد أسئلة اختيار من متعدد واضحة. جرّب تحديد صفحات أخرى.', true);
                    return;
                }
                document.getElementById('pdfImportFolderName').value =
                    (activePdfFileName || 'أسئلة من PDF').replace(/\.pdf$/i, '').slice(0, 60);
                renderExtractedQuestionReview();
                const summary = document.getElementById('pdfImportReviewSummary');
                if (summary) summary.textContent = `تم العثور على ${extractedPdfQuestions.length} سؤالًا في ${pageNumbers.length} صفحة. راجع الإجابات قبل الحفظ.`;
                const warningBox = document.getElementById('pdfImportWarnings');
                if (warningBox) {
                    warningBox.replaceChildren();
                    (Array.isArray(result.warnings) ? result.warnings : []).forEach(warning => {
                        const line = document.createElement('p');
                        line.textContent = warning;
                        warningBox.appendChild(line);
                    });
                }
                const modal = document.getElementById('pdfImportReviewModal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
                setPDFExtractStatus(`جاهز للمراجعة: ${extractedPdfQuestions.length} سؤالًا.`);
            } catch (error) {
                setPDFExtractStatus(error?.message || 'تعذر استخراج الأسئلة.', true);
            } finally {
                if (button) button.disabled = false;
            }
        }

        function renderExtractedQuestionReview() {
            const list = document.getElementById('pdfExtractedQuestionsList');
            if (!list) return;
            list.replaceChildren();
            extractedPdfQuestions.forEach((question, index) => {
                const card = document.createElement('article');
                card.className = 'custom-card p-4 rounded-xl space-y-3';
                card.dataset.importQuestion = String(index);

                const header = document.createElement('div');
                header.className = 'flex items-center justify-between gap-2';
                const title = document.createElement('strong');
                title.className = 'text-xs';
                title.textContent = `سؤال ${index + 1} • صفحة ${Number(question.pageNumber) || '?'}`;
                header.appendChild(title);
                if (question.needsReview || question.correctIndex == null) {
                    const badge = document.createElement('span');
                    badge.className = 'text-[10px] text-amber-300 font-bold';
                    badge.textContent = 'راجع الإجابة';
                    header.appendChild(badge);
                }
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'text-xs text-red-300 hover:text-red-200';
                remove.textContent = 'حذف من الاستيراد';
                remove.addEventListener('click', () => card.remove());
                header.appendChild(remove);
                card.appendChild(header);

                const questionText = document.createElement('textarea');
                questionText.className = 'w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs min-h-[72px]';
                questionText.value = String(question.text || '');
                questionText.dataset.field = 'text';
                questionText.setAttribute('aria-label', 'نص السؤال');
                card.appendChild(questionText);

                const category = document.createElement('select');
                category.className = 'p-2 bg-slate-900 border border-slate-700 rounded-lg text-xs';
                category.dataset.field = 'category';
                [['quant', 'كمي'], ['verbal', 'لفظي']].forEach(([value, label]) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    category.appendChild(option);
                });
                category.value = question.category === 'verbal' ? 'verbal' : 'quant';
                card.appendChild(category);

                const optionsGrid = document.createElement('div');
                optionsGrid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-2';
                ['أ', 'ب', 'ج', 'د'].forEach((letter, optionIndex) => {
                    const label = document.createElement('label');
                    label.className = 'flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800';
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = `pdf-correct-${index}`;
                    radio.value = String(optionIndex);
                    radio.dataset.field = 'correctIndex';
                    radio.required = true;
                    radio.checked = Number(question.correctIndex) === optionIndex;
                    radio.className = 'accent-sky-500';
                    const optionInput = document.createElement('input');
                    optionInput.type = 'text';
                    optionInput.maxLength = 500;
                    optionInput.className = 'w-full bg-transparent text-xs focus:outline-none';
                    optionInput.value = String(Array.isArray(question.options) ? question.options[optionIndex] || '' : '');
                    optionInput.dataset.field = 'option';
                    optionInput.placeholder = `خيار (${letter})`;
                    label.append(radio, optionInput);
                    optionsGrid.appendChild(label);
                });
                card.appendChild(optionsGrid);

                const explanation = document.createElement('textarea');
                explanation.className = 'w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs min-h-[56px]';
                explanation.value = String(question.explanation || '');
                explanation.dataset.field = 'explanation';
                explanation.placeholder = 'شرح الإجابة (اختياري)';
                card.appendChild(explanation);
                list.appendChild(card);
            });
        }

        function getReviewedPDFQuestions() {
            return [...document.querySelectorAll('#pdfExtractedQuestionsList [data-import-question]')]
                .map(card => {
                    const get = field => card.querySelector(`[data-field="${field}"]`);
                    const text = get('text')?.value.trim() || '';
                    const category = get('category')?.value === 'verbal' ? 'verbal' : 'quant';
                    const options = [...card.querySelectorAll('[data-field="option"]')].map(input => input.value.trim());
                    const selected = card.querySelector('[data-field="correctIndex"]:checked');
                    const source = extractedPdfQuestions[Number(card.dataset.importQuestion)] || {};
                    return {
                        category,
                        text,
                        options,
                        correctIndex: selected ? Number(selected.value) : null,
                        explanation: get('explanation')?.value.trim() || '',
                        pageNumber: Number(source.pageNumber) || null
                    };
                });
        }

        function closePDFImportReview() {
            const modal = document.getElementById('pdfImportReviewModal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        function downloadImportedQuestionsJSON() {
            const reviewed = getReviewedPDFQuestions();
            if (!reviewed.length) return alert('لا توجد أسئلة لتنزيلها.');
            const folderName = document.getElementById('pdfImportFolderName').value.trim() || 'أسئلة من PDF';
            const blob = new Blob(
                [JSON.stringify({ folder: folderName, source: activePdfFileName, questions: reviewed }, null, 2)],
                { type: 'application/json;charset=utf-8' }
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${folderName.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'qodrati-questions'}.json`;
            link.click();
            URL.revokeObjectURL(url);
        }

        async function saveImportedQuestions() {
            if (!currentUser?.uid) return alert('سجّل الدخول أولاً لحفظ الأسئلة.');
            const reviewed = getReviewedPDFQuestions();
            if (!reviewed.length) return alert('لا توجد أسئلة للحفظ.');
            const incompleteIndex = reviewed.findIndex(question =>
                !question.text || question.options.length !== 4 || question.options.some(option => !option) ||
                !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3
            );
            if (incompleteIndex >= 0) {
                alert(`أكمل نص السؤال واختياراته وحدد الإجابة الصحيحة في السؤال ${incompleteIndex + 1}.`);
                return;
            }

            const folderName = (document.getElementById('pdfImportFolderName').value.trim() || 'أسئلة من PDF').slice(0, 60);
            const previousQuestions = questions;
            const previousFolders = folders;
            const now = Date.now();
            const nextFolders = [...folders];
            const nextQuestions = [...questions];

            for (const category of new Set(reviewed.map(question => question.category))) {
                if (!nextFolders.some(folder =>
                    folder.category === category && folder.name.trim().toLowerCase() === folderName.toLowerCase()
                )) {
                    nextFolders.push({ id: `pdf_${now}_${category}`, name: folderName, category });
                }
            }

            const nextNumbers = {
                quant: questions.filter(question => question.category === 'quant').reduce((max, question) => Math.max(max, Number(question.num) || 0), 0) + 1,
                verbal: questions.filter(question => question.category === 'verbal').reduce((max, question) => Math.max(max, Number(question.num) || 0), 0) + 1
            };
            reviewed.forEach((question, index) => {
                nextQuestions.push({
                    id: `pdf_${now}_${index}`,
                    num: nextNumbers[question.category]++,
                    category: question.category,
                    folder: folderName,
                    text: question.text,
                    options: question.options,
                    correctIndex: question.correctIndex,
                    explanation: question.explanation,
                    imageUrl: null,
                    sourcePage: question.pageNumber
                });
            });

            folders = nextFolders;
            questions = nextQuestions;
            try {
                await saveStateToStorage();
            } catch (error) {
                questions = previousQuestions;
                folders = previousFolders;
                updateFolderOptionsInModal();
                updateQuizFolderOptions();
                showFirebaseError(error);
                return;
            }

            closePDFImportReview();
            updateDashboardStats();
            updateQuizFolderOptions();
            if (currentActiveTab === 'quant' || currentActiveTab === 'verbal') renderBankView();
            reviewed.forEach(() => {
                const pendingCount = window.firebaseAPI?.recordQuestionAdded?.();
                pendingCount?.catch(() => {});
            });
            setPDFExtractStatus(`تم حفظ ${reviewed.length} سؤالًا في ملف «${folderName}». يمكنك اختياره من إعداد الاختبار.`);
        }

        function savePDFQuestionQuickly() {
            const note = document.getElementById('pdfNotes').value.trim();
            if (!note) return;

            openAddQuestionModal();
            document.getElementById('qTextInput').value = note;
            document.getElementById('pdfNotes').value = '';
        }

        /* ===================================================
           QUIZ GENERATOR & TIMED ENGINE
        =================================================== */
        function resetQuizSetup() {
            document.getElementById('quizSetupCard').classList.remove('hidden');
            document.getElementById('quizActiveCard').classList.add('hidden');
            document.getElementById('quizResultCard').classList.add('hidden');
            if (quizTimerInterval) clearInterval(quizTimerInterval);
        }

        function updateQuizFolderOptions() {
            const select = document.getElementById('quizFolderSelect');
            const category = document.getElementById('quizCategorySelect')?.value || 'all';
            if (!select) return;
            const previous = select.value;
            select.replaceChildren();
            const allOption = document.createElement('option');
            allOption.value = 'all';
            allOption.textContent = 'كل الملفات';
            select.appendChild(allOption);

            const availableFolders = [...new Set(
                folders
                    .filter(folder => category === 'all' || folder.category === category)
                    .map(folder => String(folder.name || '').trim())
                    .filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'ar'));
            availableFolders.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            });
            select.value = availableFolders.includes(previous) ? previous : 'all';
        }

        function startQuiz() {
            const cat = document.getElementById('quizCategorySelect').value;
            const selectedFolder = document.getElementById('quizFolderSelect')?.value || 'all';
            const count = parseInt(document.getElementById('quizCountInput').value) || 5;
            const timeMinutes = parseInt(document.getElementById('quizTimeInput').value) || 10;

            let pool = [...questions];
            if (selectedFolder === 'all' && cat !== 'verbal') {
                pool = pool.concat(fileQuestions.map(f => ({
                    id: 'file_' + f.id, category: 'quant', folder: 'ملف الأسئلة',
                    text: f.text, options: FILE_LETTERS.map(l => `الخيار ${l}`),
                    correctIndex: f.correctIndex, letterOnly: true, imageUrl: null
                })));
            }
            if (cat !== 'all') {
                pool = pool.filter(q => q.category === cat);
            }
            if (selectedFolder !== 'all') {
                pool = pool.filter(q => q.folder === selectedFolder);
            }

            if (pool.length === 0) {
                alert('لا توجد أسئلة متاحة في هذا القسم للبدء بالاختبار!');
                return;
            }

            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            activeQuizQuestions = pool.slice(0, count);
            currentQuizIndex = 0;
            quizScore = 0;
            quizFinished = false;
            answeredQuizIndices = new Set();

            document.getElementById('quizSetupCard').classList.add('hidden');
            document.getElementById('quizActiveCard').classList.remove('hidden');

            // Timer setup
            let totalSeconds = timeMinutes * 60;
            const timerDisplay = document.getElementById('quizTimerDisplay');

            if (quizTimerInterval) clearInterval(quizTimerInterval);
            quizTimerInterval = setInterval(() => {
                totalSeconds--;
                const m = Math.floor(totalSeconds / 60);
                const s = totalSeconds % 60;
                timerDisplay.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

                if (totalSeconds <= 0) {
                    clearInterval(quizTimerInterval);
                    finishQuiz();
                }
            }, 1000);

            renderQuizQuestion();
        }

        function renderQuizQuestion() {
            const q = activeQuizQuestions[currentQuizIndex];
            document.getElementById('quizCurrentIndex').textContent = `السؤال ${currentQuizIndex + 1} من ${activeQuizQuestions.length}`;
            document.getElementById('quizCategoryBadge').textContent = q.category === 'quant' ? 'كمي' : 'لفظي';
            document.getElementById('quizQuestionText').textContent = q.text;

            const imgWrapper = document.getElementById('quizImageWrapper');
            const img = document.getElementById('quizQuestionImg');
            const imageSource = safeImageSource(q.imageUrl);
            if (imageSource) {
                img.src = imageSource;
                img.alt = 'صورة السؤال';
                imgWrapper.classList.remove('hidden');
            } else {
                img.removeAttribute('src');
                imgWrapper.classList.add('hidden');
            }

            const optionsContainer = document.getElementById('quizOptionsContainer');
            optionsContainer.innerHTML = '';

            (Array.isArray(q.options) ? q.options : []).forEach((opt, idx) => {
                const btn = document.createElement('button');
                btn.className = 'quiz-opt-btn w-full p-3.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-right text-xs font-semibold transition flex items-center justify-between';
                const label = document.createElement('span');
                label.textContent = q.letterOnly ? `الاختيار (${['أ', 'ب', 'ج', 'د'][idx]})` : `${['أ', 'ب', 'ج', 'د'][idx]} - ${String(opt ?? '')}`;
                btn.appendChild(label);
                btn.onclick = () => selectQuizOption(idx, btn);
                optionsContainer.appendChild(btn);
            });
        }

        function selectQuizOption(choiceIdx, btnEl) {
            document.querySelectorAll('#quizOptionsContainer .quiz-opt-btn').forEach(b => {
                b.classList.remove('border-sky-500', 'bg-sky-950/40');
                delete b.dataset.selected;
            });
            btnEl.classList.add('border-sky-500', 'bg-sky-950/40');
            btnEl.dataset.selected = String(choiceIdx);
        }

        // تسجّل الإجابة الحالية مرة واحدة فقط؛ تستخدمها أزرار التالي وانتهاء الوقت.
        function recordCurrentQuizAnswer() {
            if (!Array.isArray(activeQuizQuestions) || currentQuizIndex < 0 || currentQuizIndex >= activeQuizQuestions.length) return;
            if (answeredQuizIndices.has(currentQuizIndex)) return;
            const selectedBtn = document.querySelector('#quizOptionsContainer .quiz-opt-btn[data-selected]');
            if (selectedBtn) {
                const choice = Number.parseInt(selectedBtn.dataset.selected, 10);
                if (choice === Number(activeQuizQuestions[currentQuizIndex].correctIndex)) quizScore++;
            }
            answeredQuizIndices.add(currentQuizIndex);
        }

        function nextQuizQuestion() {
            if (!activeQuizQuestions.length || currentQuizIndex >= activeQuizQuestions.length) return;
            recordCurrentQuizAnswer();
            if (currentQuizIndex + 1 < activeQuizQuestions.length) {
                currentQuizIndex++;
                renderQuizQuestion();
            } else {
                // تم تسجيل إجابة السؤال الأخير قبل عرض النتيجة.
                finishQuiz();
            }
        }

        function finishQuiz() {
            if (quizFinished || !activeQuizQuestions.length) return;
            quizFinished = true;
            // إذا انتهى الوقت، احتسب الاختيار الحالي أيضًا، إن وُجد، دون تكرار أي إجابة.
            recordCurrentQuizAnswer();
            if (quizTimerInterval) clearInterval(quizTimerInterval);
            // سجّل الاختبار المنتهي في حساب المستخدم (يُحفظ بعد تسجيل الخروج والدخول).
            window.firebaseAPI?.recordQuizCompleted?.().catch(err => console.warn('تعذر حفظ عدّاد الاختبارات:', err));
            document.getElementById('quizActiveCard').classList.add('hidden');
            document.getElementById('quizResultCard').classList.remove('hidden');

            const percent = Math.round((quizScore / activeQuizQuestions.length) * 100);
            document.getElementById('quizScoreText').textContent = `${percent}%`;
            document.getElementById('quizScoreSub').textContent = `أجبت بشكل صحيح على ${quizScore} من أصل ${activeQuizQuestions.length} سؤال.`;
        }

        /* ===================================================
           COMMUNITY & DISCUSSION FEED
        =================================================== */
        function escapeCommunityHTML(value) {
            return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
        }

        function formatTimeMs(ms) {
            try { return new Date(Number(ms) || Date.now()).toLocaleString('ar-EG'); } catch (_) { return ''; }
        }

        function updateLoadMoreButton() {
            const btn = document.getElementById('loadMorePostsBtn');
            if (btn) btn.classList.toggle('hidden', !communityHasMore);
        }

        async function loadMorePosts() {
            const btn = document.getElementById('loadMorePostsBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التحميل…'; }
            try { await window.firebaseAPI.loadMorePosts(); }
            catch (error) { console.error(error); alert('تعذر تحميل المزيد من المنشورات.'); }
            finally { if (btn) { btn.disabled = false; btn.textContent = 'عرض المزيد'; } }
        }

        /* ---------- مساعدات النوافذ ---------- */
        function showModal(id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('hidden');
            el.classList.add('flex');
            refreshBodyLock();
        }
        function hideModal(id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.add('hidden');
            el.classList.remove('flex');
            refreshBodyLock();
        }
        function isModalOpen(id) {
            const el = document.getElementById(id);
            return !!el && !el.classList.contains('hidden');
        }
        function refreshBodyLock() {
            const any = ['repliesModal', 'notifModal', 'reportModal'].some(isModalOpen);
            document.body.classList.toggle('overflow-hidden', any);
        }
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (isModalOpen('reportModal')) closeReportModal();
            else if (isModalOpen('repliesModal')) closeReplies();
            else if (isModalOpen('notifModal')) closeNotifications();
        });

        function guardCanParticipate() {
            if (!currentUser) { alert('سجّل الدخول أولًا.'); return false; }
            if (currentUser.banned) { alert('تم إيقاف مشاركتك في المجتمع من قِبل الإدارة.'); return false; }
            return true;
        }

        function findPost(postId) {
            return comments.find(c => Number(c.id) === Number(postId));
        }

        /* ---------- عرض المنشورات ---------- */
        function renderCommunityComments() {
            const feed = document.getElementById('commentsFeed');
            if (!feed) return;
            feed.innerHTML = '';
            updateLoadMoreButton();
            if (!comments.length) {
                feed.innerHTML = '<div class="custom-card p-6 rounded-xl text-center text-sm text-slate-400">لا توجد منشورات بعد. كن أول من يشارك سؤالًا أو نصيحة!</div>';
                return;
            }
            const isAdminUser = currentUser?.role === 'admin';
            comments.forEach(c => {
                if (!Array.isArray(c.likes)) c.likes = [];
                if (!Array.isArray(c.replies)) c.replies = [];
                const liked = currentUser && c.likes.includes(currentUser.uid);
                const card = document.createElement('article');
                card.className = 'custom-card p-4 rounded-xl space-y-3';
                const imageMarkup = safeImageSource(c.image) ? `<img src="${escapeHTML(safeImageSource(c.image))}" alt="صورة مرفقة بالمنشور" class="rounded-xl max-h-80 max-w-full object-contain" loading="lazy">` : '';
                const postId = Number(c.id);
                const isOwnPost = !!currentUser?.uid && c.authorUid === currentUser.uid;
                const btn = 'px-3 py-2 rounded-lg text-xs';
                // الحذف متاح لصاحب المنشور وللأدمن (والـ Rules تفرض ذلك في الخادم أيضًا).
                const deleteButton = (isAdminUser || isOwnPost)
                    ? `<button type="button" class="${btn} bg-red-900/70" onclick="deleteCommunityPost(${postId})">${isAdminUser && !isOwnPost ? 'حذف المنشور (أدمن)' : 'حذف منشوري'}</button>`
                    : '';
                const reportButton = (currentUser && !isOwnPost)
                    ? `<button type="button" class="${btn} bg-slate-800" onclick="reportPost(${postId})">🚩 إبلاغ</button>`
                    : '';
                const banButton = (isAdminUser && !isOwnPost && c.authorUid)
                    ? `<button type="button" class="${btn} bg-slate-800" data-action="ban" data-uid="${escapeHTML(c.authorUid)}" data-name="${escapeHTML(c.author)}">🚫 حظر/فك حظر</button>`
                    : '';
                const reportCount = isAdminUser ? Number(reportCountsPost[String(c.id)] || 0) : 0;
                const reportBadge = reportCount > 0 ? `<span class="${btn} bg-red-950 border border-red-700 text-red-300">🚩 ${reportCount} بلاغ</span>` : '';
                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2"><div class="min-w-0"><div class="font-bold text-xs break-words">${escapeCommunityHTML(c.author)} ${c.authorRole === 'admin' ? '<span class="text-amber-400">• أدمن</span>' : ''}</div><div class="text-[10px] text-slate-400">${escapeCommunityHTML(c.time || 'الآن')}</div></div></div>
                    <p class="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap break-words">${escapeCommunityHTML(c.text)}</p>${imageMarkup}
                    <div class="flex flex-wrap gap-2">
                        <button type="button" class="${btn} bg-slate-800" onclick="togglePostLike(${postId})">${liked ? '❤️' : '🤍'} إعجاب (${c.likes.length})</button>
                        <button type="button" class="${btn} bg-slate-800" onclick="openReplies(${postId})">💬 الردود (${c.replies.length})</button>
                        ${reportButton}${deleteButton}${banButton}${reportBadge}
                    </div>`;
                feed.appendChild(card);
            });
        }

        /* ---------- نافذة الردود ---------- */
        let openRepliesPostId = null;
        let lastRepliesCount = -1;
        let scrollRepliesToBottom = false;

        function openReplies(postId) {
            if (!currentUser) { alert('سجّل الدخول أولًا.'); return; }
            openRepliesPostId = Number(postId);
            lastRepliesCount = -1;
            showModal('repliesModal');
            renderRepliesModal(true);
            if (window.matchMedia('(min-width: 640px)').matches) document.getElementById('replyModalInput')?.focus();
        }

        function closeReplies() {
            openRepliesPostId = null;
            hideModal('repliesModal');
        }

        function renderRepliesModal(forceBottom) {
            if (openRepliesPostId == null) return;
            const post = findPost(openRepliesPostId);
            if (!post) { closeReplies(); return; } // المنشور اتحذف
            const list = document.getElementById('repliesList');
            const replies = Array.isArray(post.replies) ? post.replies : [];
            const isAdminUser = currentUser?.role === 'admin';
            document.getElementById('repliesTitle').textContent = `الردود (${replies.length})`;
            document.getElementById('repliesPostPreview').textContent = `${post.author || ''}: ${post.text || '(منشور بصورة)'}`;

            const prevTop = list.scrollTop;
            const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
            const small = 'text-[11px]';
            list.innerHTML = replies.length ? replies.map(r => {
                const rid = String(r.id ?? '');
                const isOwn = !!currentUser?.uid && r.uid === currentUser.uid;
                const reportBtn = (currentUser && !isOwn && rid)
                    ? `<button type="button" class="${small} text-slate-400 hover:text-red-400" data-action="report-reply" data-post="${Number(post.id)}" data-reply="${escapeHTML(rid)}">🚩 إبلاغ</button>` : '';
                const removeBtn = (isAdminUser && rid)
                    ? `<button type="button" class="${small} text-red-400" data-action="remove-reply" data-post="${Number(post.id)}" data-reply="${escapeHTML(rid)}">حذف الرد</button>` : '';
                const banBtn = (isAdminUser && !isOwn && r.uid)
                    ? `<button type="button" class="${small} text-slate-400 hover:text-white" data-action="ban" data-uid="${escapeHTML(r.uid)}" data-name="${escapeHTML(r.author)}">🚫 حظر/فك حظر</button>` : '';
                const count = isAdminUser ? Number(reportCountsReply[`${post.id}:${rid}`] || 0) : 0;
                const badge = count > 0 ? `<span class="${small} text-red-300">🚩 ${count} بلاغ</span>` : '';
                return `<div class="rounded-xl bg-slate-900/60 border border-slate-800 p-3">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs font-bold break-words min-w-0">${escapeCommunityHTML(r.author)} ${r.role === 'admin' ? '<span class="text-amber-400">• أدمن</span>' : ''}</div>
                        <div class="text-[10px] text-slate-500 shrink-0">${escapeCommunityHTML(r.time || '')}</div>
                    </div>
                    <p class="text-sm text-slate-200 mt-1 whitespace-pre-wrap break-words">${escapeCommunityHTML(r.text)}</p>
                    <div class="flex flex-wrap items-center gap-3 mt-2">${reportBtn}${removeBtn}${banBtn}${badge}</div>
                </div>`;
            }).join('') : '<p class="text-xs text-slate-500 text-center py-8">لا توجد ردود بعد. كن أول من يرد!</p>';

            const grew = lastRepliesCount >= 0 && replies.length > lastRepliesCount;
            if (forceBottom || (grew && (scrollRepliesToBottom || nearBottom))) {
                list.scrollTop = list.scrollHeight;
                if (grew) scrollRepliesToBottom = false;
            } else {
                list.scrollTop = prevTop;
            }
            lastRepliesCount = replies.length;
        }

        async function submitReply(e) {
            e.preventDefault();
            if (!guardCanParticipate()) return;
            if (!currentUser.uid || !currentUser.username || !window.firebaseAPI?.ready) {
                alert('جلسة الدخول أو الاتصال بفايربيس غير مكتمل. سجّل الخروج ثم ادخل مرة أخرى.');
                return;
            }
            const postId = openRepliesPostId;
            if (postId == null) return;
            const input = document.getElementById('replyModalInput');
            const submit = document.getElementById('replyModalSubmit');
            const text = input.value.trim();
            if (!text) { input.focus(); return; }
            if (text.length > 500) { alert('الرد يجب ألا يزيد عن 500 حرف.'); return; }

            submit.disabled = true;
            // نفرّغ الخانة فورًا؛ لو فشل الإرسال نرجّع النص حتى لا يضيع على المستخدم.
            input.value = '';
            scrollRepliesToBottom = true;
            const desktop = window.matchMedia('(min-width: 640px)').matches;
            try {
                const reply = {
                    id: Date.now(),
                    uid: currentUser.uid,
                    author: String(currentUser.username).trim(),
                    text,
                    time: new Date().toLocaleString('ar-EG')
                };
                if (currentUser.role === 'admin') reply.role = 'admin';
                await window.firebaseAPI.addReply(String(postId), reply);
            } catch (error) {
                console.error('تعذر إرسال الرد إلى communityPosts:', error);
                scrollRepliesToBottom = false;
                if (!input.value) input.value = text;
                if (error?.code === 'permission-denied' || error?.code === 'firestore/permission-denied') {
                    alert('فايربيس رفض الرد بسبب قواعد Firestore. تأكد أنك نشرت آخر نسخة من الـ Rules، وأن حسابك غير محظور.');
                } else {
                    alert('تعذر إرسال الرد: ' + (error?.message || 'خطأ غير معروف'));
                }
            } finally {
                submit.disabled = false;
                if (desktop) input.focus();
            }
        }

        /* ---------- الإبلاغ ---------- */
        const REPORT_REASONS = ['ألفاظ مسيئة أو إساءة', 'سبام أو إعلان', 'أسئلة اختبار رسمية مسرّبة', 'معلومات خاطئة أو مضللة', 'سبب آخر'];
        let reportTarget = null;

        function openReportModal(target) {
            if (!guardCanParticipate()) return;
            reportTarget = target;
            document.getElementById('reportModalTitle').innerHTML = `<i class="fa-solid fa-flag text-red-400"></i> ${target.replyId ? 'الإبلاغ عن رد' : 'الإبلاغ عن منشور'}`;
            document.getElementById('reportReasons').innerHTML = REPORT_REASONS.map((label, i) => `
                <label class="flex items-center gap-2 p-2.5 rounded-xl border border-slate-700 bg-slate-900/60 text-xs cursor-pointer">
                    <input type="radio" name="reportReason" value="${i}" ${i === 0 ? 'checked' : ''} class="accent-sky-500">
                    <span>${escapeHTML(label)}</span>
                </label>`).join('');
            showModal('reportModal');
        }

        function closeReportModal() {
            reportTarget = null;
            hideModal('reportModal');
        }

        function reportPost(postId) { openReportModal({ postId: String(postId), replyId: null }); }
        function reportReply(postId, replyId) { openReportModal({ postId: String(postId), replyId: String(replyId) }); }

        async function submitReport() {
            if (!reportTarget) return;
            const checked = document.querySelector('input[name="reportReason"]:checked');
            const reason = REPORT_REASONS[Number(checked?.value || 0)] || REPORT_REASONS[REPORT_REASONS.length - 1];
            const btn = document.getElementById('reportSubmitBtn');
            const target = reportTarget;
            btn.disabled = true;
            try {
                await window.firebaseAPI.reportPost(target.postId, target.replyId, reason);
                closeReportModal();
                showToast('تم إرسال البلاغ', 'وصل البلاغ للإدارة، شكرًا لمساعدتك.');
            } catch (error) {
                console.error(error);
                if (error?.code === 'permission-denied') alert('لقد أبلغت عن هذا من قبل، أو أن حسابك غير مسموح له بالإبلاغ.');
                else alert('تعذر إرسال البلاغ، حاول مرة أخرى.');
            } finally {
                btn.disabled = false;
            }
        }

        /* ---------- نشر وحذف وإعجاب ---------- */
        async function postComment(e) {
            e.preventDefault();
            if (!guardCanParticipate()) return;
            const input = document.getElementById('commentInput');
            const text = input.value.trim();
            const fileInput = document.getElementById('communityImage');
            const file = fileInput?.files?.[0];
            if (!text && !file) { alert('اكتب منشورًا أو أرفق صورة.'); return; }
            let image = null;
            if (file) {
                if (!file.type.startsWith('image/')) { alert('من فضلك اختر ملف صورة فقط.'); return; }
                if (file.size > 8 * 1024 * 1024) { alert('حجم الصورة الأصلية لازم يكون أقل من 8 ميجابايت، وسيتم ضغطها قبل حفظها.'); return; }
                try { image = await window.firebaseAPI.uploadFile(file, `community/${currentUser.uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`); }
                catch (error) { console.error(error); alert('تعذر تجهيز الصورة. جرّب صورة أصغر أو أوضح.'); return; }
            }
            try {
                const post = { id: Date.now(), author: currentUser.username, authorUid: currentUser.uid, gender: currentUser.gender, text, image, likes: [], replies: [], createdAt: Date.now(), time: new Date().toLocaleString('ar-EG') };
                // علامة الأدمن تُقبل في الـ Rules فقط إذا كان الحساب أدمن فعلًا.
                if (currentUser.role === 'admin') post.authorRole = 'admin';
                await window.firebaseAPI.createPost(post);
                input.value = ''; if (fileInput) fileInput.value = '';
            } catch (error) { console.error(error); alert('لم يتم نشر المنشور. تأكد من قواعد Firestore وأن حسابك غير محظور.'); }
        }

        async function deleteCommunityPost(postId) {
            if (!currentUser) { alert('سجّل الدخول أولًا.'); return; }
            if (!confirm('متأكد إنك عايز تحذف المنشور وكل الردود التابعة له؟')) return;
            try {
                await window.firebaseAPI.deletePost(postId);
                if (currentUser.role === 'admin') dismissReportsMatching(r => String(r.postId) === String(postId));
            } catch (error) { console.error(error); alert('تعذر حذف المنشور. الحذف متاح لصاحب المنشور أو للأدمن فقط.'); }
        }

        async function togglePostLike(postId) {
            if (!guardCanParticipate()) return;
            const post = findPost(postId); if (!post) return;
            try { await window.firebaseAPI.toggleLike(postId, currentUser.uid, Array.isArray(post.likes) && post.likes.includes(currentUser.uid)); }
            catch (error) { console.error(error); alert('تعذر تسجيل الإعجاب.'); }
        }

        /* ---------- أدوات الأدمن: حظر وحذف رد ---------- */
        async function toggleBanUser(uid, name) {
            if (!currentUser || currentUser.role !== 'admin') return;
            if (!uid || uid === currentUser.uid) return;
            try {
                const banned = await window.firebaseAPI.getUserBanned(uid);
                const label = name || 'هذا المستخدم';
                if (!confirm(banned ? `فك الحظر عن "${label}"؟` : `حظر "${label}" من النشر والرد والإعجاب والإبلاغ؟`)) return;
                await window.firebaseAPI.setBanned(uid, !banned);
                showToast(banned ? 'تم فك الحظر' : 'تم الحظر', label);
                if (isModalOpen('notifModal') && notifTab === 'reports') renderNotifModal();
            } catch (error) {
                console.error(error);
                alert('تعذر تنفيذ الحظر. تأكد من نشر آخر نسخة من الـ Rules، ولا يمكن حظر أدمن آخر.');
            }
        }

        async function adminRemoveReply(postId, replyId) {
            if (!currentUser || currentUser.role !== 'admin') return;
            if (!confirm('حذف هذا الرد نهائيًا؟')) return;
            try {
                await window.firebaseAPI.removeReply(postId, replyId);
                reportPostCache.delete(String(postId));
                dismissReportsMatching(r => String(r.postId) === String(postId) && String(r.replyId || '') === String(replyId));
                showToast('تم حذف الرد', '');
            } catch (error) {
                console.error(error);
                alert('تعذر حذف الرد. تأكد من نشر آخر نسخة من الـ Rules.');
            }
        }

        // يغلق (يحذف) البلاغات المطابقة بعد معالجتها.
        function dismissReportsMatching(predicate) {
            const ids = reportDocs.filter(predicate).map(r => r.id);
            if (!ids.length) return Promise.resolve();
            return window.firebaseAPI.dismissReports(ids).catch(err => console.warn('تعذر إغلاق البلاغات:', err));
        }

        // أزرار تعتمد على data-action حتى لا نضع أسماء المستخدمين داخل onclick.
        document.addEventListener('click', e => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const { action, uid, name, post, reply, id } = btn.dataset;
            if (action === 'ban') toggleBanUser(uid, name);
            else if (action === 'remove-reply') adminRemoveReply(post, reply);
            else if (action === 'report-reply') reportReply(post, reply);
            else if (action === 'del-notif') deleteNotification(id);
        });

        /* ===================================================
           NOTIFICATIONS (إشعارات الأدمن + بلاغات للأدمن)
        =================================================== */
        function showToast(title, body) {
            const box = document.getElementById('toastBox');
            if (!box) return;
            while (box.children.length >= 3) box.removeChild(box.firstChild);
            const el = document.createElement('div');
            el.className = 'pointer-events-auto w-full max-w-sm custom-card rounded-xl shadow-2xl border border-amber-500/50 p-3 text-right cursor-pointer';
            el.innerHTML = `<div class="font-bold text-sm break-words">${escapeHTML(title)}</div>${body ? `<div class="text-xs text-slate-300 mt-0.5 break-words line-clamp-3">${escapeHTML(body)}</div>` : ''}`;
            el.onclick = () => { el.remove(); openNotifications(); };
            box.appendChild(el);
            setTimeout(() => el.remove(), 7000);
        }

        function pushBrowserNotification(title, body) {
            try {
                if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
                    new Notification(title, { body: body || '' });
                }
            } catch (_) { /* بعض المتصفحات تمنع الإنشاء المباشر */ }
        }

        function effectiveSeenAt() {
            return notifSeenAt || (Date.parse(currentUser?.joinedAt || '') || 0);
        }

        function unreadAnnouncements() {
            if (!notifSeenLoaded || !currentUser) return 0;
            const seen = effectiveSeenAt();
            return notifications.filter(n => n.authorUid !== currentUser.uid && Number(n.createdAtMs) > seen).length;
        }

        function groupReports() {
            const map = new Map();
            reportDocs.forEach(r => {
                const replyId = r.replyId ? String(r.replyId) : null;
                const key = replyId ? `${r.postId}:${replyId}` : String(r.postId);
                if (!map.has(key)) map.set(key, { key, postId: String(r.postId), replyId, items: [] });
                map.get(key).items.push(r);
            });
            const latest = g => Math.max(...g.items.map(i => Number(i.createdAtMs) || 0));
            return [...map.values()].sort((a, b) => latest(b) - latest(a));
        }

        function updateBell() {
            const badge = document.getElementById('bellBadge');
            if (!badge) return;
            const isAdminUser = currentUser?.role === 'admin';
            const reportGroups = isAdminUser ? groupReports().length : 0;
            const total = unreadAnnouncements() + reportGroups;
            badge.textContent = total > 99 ? '99+' : String(total);
            badge.classList.toggle('hidden', total === 0);
            badge.classList.toggle('flex', total > 0);
            const rc = document.getElementById('notifReportsCount');
            if (rc) { rc.textContent = String(reportGroups); rc.classList.toggle('hidden', reportGroups === 0); }
        }

        function resetNotificationState() {
            notifications = []; notifSeenAt = 0; notifSeenLoaded = false; reportDocs = [];
            reportCountsPost = {}; reportCountsReply = {}; reportPostCache.clear();
            closeReplies(); closeReportModal(); hideModal('notifModal');
            updateBell();
        }

        window.applyCloudNotifications = function(items) {
            notifications = Array.isArray(items) ? items : [];
            updateBell();
            if (isModalOpen('notifModal')) renderNotifModal();
        };
        window.applyNotifSeen = function(ms) {
            notifSeenAt = Number(ms) || 0;
            notifSeenLoaded = true;
            updateBell();
        };
        window.applyCloudReportDocs = function(list) {
            reportDocs = Array.isArray(list) ? list : [];
            reportCountsPost = {}; reportCountsReply = {};
            reportDocs.forEach(r => {
                if (r.replyId) { const k = `${r.postId}:${r.replyId}`; reportCountsReply[k] = (reportCountsReply[k] || 0) + 1; }
                else reportCountsPost[String(r.postId)] = (reportCountsPost[String(r.postId)] || 0) + 1;
            });
            updateBell();
            if (currentActiveTab === 'community') renderCommunityComments();
            if (isModalOpen('repliesModal')) renderRepliesModal(false);
            if (isModalOpen('notifModal') && notifTab === 'reports') renderNotifModal();
        };
        window.onNewAnnouncement = function(n) {
            if (!n || n.authorUid === currentUser?.uid) return;
            showToast('📢 ' + (n.title || 'إشعار جديد'), n.body || '');
            pushBrowserNotification(n.title || 'إشعار جديد', n.body || '');
        };
        window.onNewReport = function(r) {
            if (currentUser?.role !== 'admin' || !r) return;
            const where = r.replyId ? 'على رد' : 'على منشور';
            showToast('🚩 بلاغ جديد', `${where}: ${r.reason || ''}`);
            pushBrowserNotification('بلاغ جديد في قدراتي', `${where}: ${r.reason || ''}`);
        };

        function openNotifications() {
            if (!currentUser) return;
            const isAdminUser = currentUser.role === 'admin';
            notifUnreadBefore = effectiveSeenAt();
            const tabs = document.getElementById('notifTabs');
            tabs.classList.toggle('hidden', !isAdminUser);
            tabs.classList.toggle('flex', isAdminUser);
            notifTab = (isAdminUser && groupReports().length > 0 && unreadAnnouncements() === 0) ? 'reports' : 'inbox';
            showModal('notifModal');
            renderNotifModal();
            markNotificationsSeen();
        }

        function closeNotifications() { hideModal('notifModal'); }

        function markNotificationsSeen() {
            const newest = notifications.reduce((m, n) => Math.max(m, Number(n.createdAtMs) || 0), 0);
            if (!newest || newest <= notifSeenAt) return;
            notifSeenAt = newest;
            notifSeenLoaded = true;
            updateBell();
            window.firebaseAPI?.markNotificationsSeen?.(newest).catch(err => console.warn('تعذر حفظ حالة قراءة الإشعارات:', err));
        }

        function setNotifTab(tab) {
            notifTab = tab;
            renderNotifModal();
        }

        function renderNotifModal() {
            const isAdminUser = currentUser?.role === 'admin';
            if (!isAdminUser) notifTab = 'inbox';
            ['inbox', 'reports', 'send'].forEach(t => {
                const b = document.getElementById(`notifTab-${t}`);
                if (!b) return;
                const active = t === notifTab;
                b.classList.toggle('btn-primary', active);
                b.classList.toggle('bg-slate-800', !active);
                b.classList.toggle('text-slate-300', !active);
            });
            const body = document.getElementById('notifBody');
            if (notifTab === 'reports') renderReportsTab(body);
            else if (notifTab === 'send') renderSendTab(body);
            else renderInboxTab(body);
            renderNotifFooter();
        }

        function renderInboxTab(body) {
            const isAdminUser = currentUser?.role === 'admin';
            if (!notifications.length) {
                body.innerHTML = '<div class="text-center text-slate-500 py-12"><i class="fa-regular fa-bell-slash text-4xl mb-2"></i><p class="text-sm">لا توجد إشعارات حتى الآن.</p></div>';
                return;
            }
            body.innerHTML = notifications.map(n => {
                const isNew = n.authorUid !== currentUser?.uid && Number(n.createdAtMs) > notifUnreadBefore;
                return `<div class="rounded-xl border ${isNew ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-700 bg-slate-900/50'} p-3 space-y-1">
                    <div class="flex items-start justify-between gap-2">
                        <div class="font-bold text-sm break-words min-w-0">${escapeHTML(n.title)} ${isNew ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-black mr-1">جديد</span>' : ''}</div>
                        ${isAdminUser ? `<button type="button" data-action="del-notif" data-id="${escapeHTML(n.id)}" class="text-slate-500 hover:text-red-400 text-xs shrink-0" title="حذف الإشعار"><i class="fa-solid fa-trash"></i></button>` : ''}
                    </div>
                    <p class="text-xs text-slate-300 whitespace-pre-wrap break-words">${escapeHTML(n.body)}</p>
                    <div class="text-[10px] text-slate-500">${escapeHTML(formatTimeMs(n.createdAtMs))}</div>
                </div>`;
            }).join('');
        }

        async function deleteNotification(id) {
            if (currentUser?.role !== 'admin' || !id) return;
            if (!confirm('حذف هذا الإشعار لكل المستخدمين؟')) return;
            try { await window.firebaseAPI.deleteAnnouncement(id); }
            catch (error) { console.error(error); alert('تعذر حذف الإشعار.'); }
        }

        function renderSendTab(body) {
            body.innerHTML = `
                <form onsubmit="submitAnnouncement(event)" class="space-y-3">
                    <p class="text-xs text-slate-400">الرسالة هتظهر لكل المستخدمين المسجلين في جرس الإشعارات، وكتنبيه فوري لمن يكون الموقع مفتوحًا عنده.</p>
                    <div>
                        <label class="block text-xs font-semibold mb-1">العنوان</label>
                        <input id="announceTitle" required maxlength="100" class="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm" placeholder="مثال: تحديث جديد في الموقع">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold mb-1">نص الرسالة</label>
                        <textarea id="announceBody" required maxlength="600" class="w-full p-3 h-32 resize-none rounded-xl bg-slate-900 border border-slate-700 text-sm" placeholder="اكتب رسالتك للطلاب..."></textarea>
                    </div>
                    <button id="announceBtn" type="submit" class="btn-primary w-full py-3 rounded-xl text-xs font-bold"><i class="fa-solid fa-paper-plane"></i> إرسال لكل المستخدمين</button>
                </form>`;
        }

        async function submitAnnouncement(e) {
            e.preventDefault();
            if (currentUser?.role !== 'admin') return;
            const title = document.getElementById('announceTitle').value.trim();
            const bodyText = document.getElementById('announceBody').value.trim();
            if (!title || !bodyText) return;
            if (!confirm('سيصل هذا الإشعار لكل المستخدمين. تأكيد الإرسال؟')) return;
            const btn = document.getElementById('announceBtn');
            btn.disabled = true;
            try {
                await window.firebaseAPI.sendAnnouncement({ title, body: bodyText });
                showToast('تم الإرسال', 'وصل الإشعار لكل المستخدمين.');
                setNotifTab('inbox');
            } catch (error) {
                console.error(error);
                alert('تعذر إرسال الإشعار. تأكد من نشر آخر نسخة من الـ Rules وأن حسابك أدمن.');
                btn.disabled = false;
            }
        }

        function renderNotifFooter() {
            const f = document.getElementById('notifFooter');
            if (!f) return;
            if (!('Notification' in window)) { f.classList.add('hidden'); return; }
            const perm = Notification.permission;
            if (perm === 'default') {
                f.innerHTML = '<button type="button" onclick="enableBrowserNotifications()" class="px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-bold text-white">🔔 تفعيل إشعارات المتصفح</button><p class="mt-1">تظهر الإشعارات حتى لو كنت في تبويب آخر، بشرط أن يظل الموقع مفتوحًا في المتصفح.</p>';
            } else if (perm === 'granted') {
                f.textContent = 'إشعارات المتصفح مفعّلة، وتعمل طالما الموقع مفتوح في المتصفح.';
            } else {
                f.textContent = 'إشعارات المتصفح محظورة من إعدادات المتصفح لهذا الموقع.';
            }
            f.classList.remove('hidden');
        }

        function enableBrowserNotifications() {
            try { Notification.requestPermission().then(renderNotifFooter); } catch (_) { renderNotifFooter(); }
        }

        /* ---------- تبويب البلاغات (للأدمن) ---------- */
        async function getPostForReport(postId) {
            const key = String(postId);
            const cached = reportPostCache.get(key);
            if (cached && Date.now() - cached.at < 30000) return cached.post;
            const local = findPost(postId);
            const post = local || await window.firebaseAPI.getPost(postId);
            reportPostCache.set(key, { at: Date.now(), post });
            return post;
        }

        function renderReportsTab(body) {
            const groups = groupReports();
            if (!groups.length) {
                body.innerHTML = '<div class="text-center text-slate-500 py-12"><i class="fa-regular fa-circle-check text-4xl mb-2"></i><p class="text-sm">لا توجد بلاغات مفتوحة.</p></div>';
                return;
            }
            body.innerHTML = '';
            groups.forEach(g => {
                const reasons = {};
                g.items.forEach(i => { const r = i.reason || 'غير محدد'; reasons[r] = (reasons[r] || 0) + 1; });
                const reasonsText = Object.entries(reasons).map(([r, n]) => `${r} (${n})`).join(' • ');
                const latest = Math.max(...g.items.map(i => Number(i.createdAtMs) || 0));
                const card = document.createElement('div');
                card.className = 'rounded-xl border border-red-800/60 bg-slate-900/60 p-3 space-y-2';
                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2 text-xs">
                        <span class="font-bold text-red-300">🚩 ${g.items.length} بلاغ • ${g.replyId ? 'على رد' : 'على منشور'}</span>
                        <span class="text-slate-500 text-[10px]">${escapeHTML(formatTimeMs(latest))}</span>
                    </div>
                    <div class="text-[11px] text-slate-400 break-words">${escapeHTML(reasonsText)}</div>
                    <div data-content class="text-xs text-slate-200 rounded-lg bg-slate-950/50 border border-slate-800 p-2">جارٍ تحميل المحتوى…</div>
                    <div data-actions class="flex flex-wrap gap-2"></div>`;
                body.appendChild(card);
                fillReportCard(card, g);
            });
        }

        async function fillReportCard(card, g) {
            const contentEl = card.querySelector('[data-content]');
            const actionsEl = card.querySelector('[data-actions]');
            const addBtn = (label, cls, handler) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `px-3 py-1.5 rounded-lg text-xs ${cls}`;
                b.textContent = label;
                b.onclick = handler;
                actionsEl.appendChild(b);
                return b;
            };
            const addDismiss = () => addBtn('تجاهل البلاغ', 'bg-slate-800', async () => {
                await dismissReportsMatching(r => (r.replyId ? `${r.postId}:${r.replyId}` : String(r.postId)) === g.key);
            });
            let post;
            try { post = await getPostForReport(g.postId); }
            catch (error) { console.error(error); if (card.isConnected) { contentEl.textContent = 'تعذر تحميل المحتوى.'; addDismiss(); } return; }
            if (!card.isConnected) return;
            if (!post) { contentEl.textContent = 'المنشور محذوف بالفعل.'; addDismiss(); return; }
            const reply = g.replyId ? (Array.isArray(post.replies) ? post.replies : []).find(r => String(r.id) === String(g.replyId)) : null;
            if (g.replyId && !reply) { contentEl.textContent = 'الرد محذوف بالفعل.'; addDismiss(); return; }
            const authorUid = reply ? reply.uid : post.authorUid;
            const authorName = reply ? reply.author : post.author;
            const text = String(reply ? reply.text : (post.text || '')).slice(0, 400);
            contentEl.innerHTML = `<div class="font-bold text-[11px] text-slate-400 mb-1">${escapeHTML(authorName)}</div><div class="whitespace-pre-wrap break-words">${escapeHTML(text) || '(بدون نص)'}${!reply && post.image ? ' <span class="text-slate-500">[صورة مرفقة]</span>' : ''}</div>`;
            if (reply) addBtn('حذف الرد', 'bg-red-900/70', () => adminRemoveReply(g.postId, g.replyId));
            else addBtn('حذف المنشور', 'bg-red-900/70', async () => {
                if (!confirm('حذف المنشور وكل ردوده نهائيًا؟')) return;
                try {
                    await window.firebaseAPI.deletePost(g.postId);
                    reportPostCache.delete(String(g.postId));
                    await dismissReportsMatching(r => String(r.postId) === String(g.postId));
                } catch (error) { console.error(error); alert('تعذر حذف المنشور.'); }
            });
            if (authorUid && authorUid !== currentUser.uid) {
                const banBtn = addBtn('حظر الكاتب', 'bg-slate-800', () => toggleBanUser(authorUid, authorName));
                window.firebaseAPI.getUserBanned(authorUid).then(b => { if (b && banBtn.isConnected) banBtn.textContent = 'فك حظر الكاتب'; }).catch(() => {});
            }
            addDismiss();
        }


        /* ===================================================
           GAMIFICATION: DUEL, DAILY CHALLENGE, INFINITE GENERATOR,
           AUTO-MISTAKES FOLDER, GUEST MODE & WEEKLY LEAGUE
        =================================================== */
        const GUEST_STORAGE_KEY = 'qodrati_guest_state_v1';
        let isGuestMode = false;
        let soundEnabled = true;

        function getGuestState() {
            try {
                const raw = localStorage.getItem(GUEST_STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    return {
                        weeklyPoints: Number(parsed.weeklyPoints) || 0,
                        totalPoints: Number(parsed.totalPoints) || 0,
                        weekId: String(parsed.weekId || getCurrentWeekId()),
                        dailyStreak: Number(parsed.dailyStreak) || 0,
                        lastDailyDate: String(parsed.lastDailyDate || ''),
                        duelsWon: Number(parsed.duelsWon) || 0
                    };
                }
            } catch (_) {}
            return { weeklyPoints: 0, totalPoints: 0, weekId: getCurrentWeekId(), dailyStreak: 0, lastDailyDate: '', duelsWon: 0 };
        }

        function saveGuestState(st) {
            try { localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(st)); } catch (_) {}
        }

        function clearGuestState() {
            try { localStorage.removeItem(GUEST_STORAGE_KEY); } catch (_) {}
        }

        // Week ID in Asia/Riyadh (starts Sunday 00:00)
        function getCurrentWeekId() {
            const now = new Date();
            const riyadhStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
            const [y, m, d] = riyadhStr.split('-').map(Number);
            const dt = new Date(Date.UTC(y, m - 1, d));
            const day = dt.getUTCDay(); // 0 = Sunday
            dt.setUTCDate(dt.getUTCDate() - day);
            return dt.toISOString().slice(0, 10);
        }

        function getTodayDateKey() {
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        }

        function getYesterdayDateKey() {
            const d = new Date(Date.now() - 86400000);
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        }

        function updateLeagueCountdown() {
            const el = document.getElementById('permanentLeagueStatus');
            if (!el) return;
            const now = new Date();
            const riyadhNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
            const nextSunday = new Date(riyadhNow);
            const daysUntilSunday = (7 - riyadhNow.getDay()) % 7 || 7;
            nextSunday.setDate(riyadhNow.getDate() + daysUntilSunday);
            nextSunday.setHours(0, 0, 0, 0);
            const diffMs = Math.max(0, nextSunday - riyadhNow);
            const days = Math.floor(diffMs / 86400000);
            const hours = Math.floor((diffMs % 86400000) / 3600000);
            el.textContent = `${days} يوم و ${hours} ساعة`;
        }

        // Web Audio Sound Effects (zero external audio files)
        function playGameSFX(type) {
            if (!soundEnabled) return;
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                const ctx = new Ctx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                const now = ctx.currentTime;
                if (type === 'correct') {
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(523.25, now);
                    osc.frequency.setValueAtTime(659.25, now + 0.09);
                    gain.gain.setValueAtTime(0.14, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
                    osc.start(now);
                    osc.stop(now + 0.29);
                } else if (type === 'wrong') {
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(220, now);
                    osc.frequency.linearRampToValueAtTime(150, now + 0.22);
                    gain.gain.setValueAtTime(0.11, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
                    osc.start(now);
                    osc.stop(now + 0.25);
                } else if (type === 'win') {
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(523.25, now);
                    osc.frequency.setValueAtTime(659.25, now + 0.1);
                    osc.frequency.setValueAtTime(783.99, now + 0.2);
                    gain.gain.setValueAtTime(0.16, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
                    osc.start(now);
                    osc.stop(now + 0.46);
                }
            } catch (_) {}
        }

        function toggleSoundFX() {
            soundEnabled = !soundEnabled;
            const btn = document.getElementById('soundFxBtn');
            if (btn) {
                btn.innerHTML = soundEnabled
                    ? '<i class="fa-solid fa-volume-high text-sky-400"></i> <span>الأصوات: مفعّلة</span>'
                    : '<i class="fa-solid fa-volume-xmark text-slate-400"></i> <span>الأصوات: صامت</span>';
            }
        }

        function getRankLevelTitle(totalPts) {
            const p = Number(totalPts) || 0;
            if (p >= 1000) return 'أسطورة القدرات 👑';
            if (p >= 500) return 'دافور قدرات 🔥';
            if (p >= 200) return 'متمرس 🚀';
            if (p >= 50) return 'مجتهد ⭐';
            return 'مبتدئ قدرات 🌱';
        }

        function getEffectiveGamificationStats() {
            const curWeek = getCurrentWeekId();
            if (currentUser && !isGuestMode) {
                const isSameWeek = currentUser.weekId === curWeek;
                return {
                    weeklyPoints: isSameWeek ? (Number(currentUser.weeklyPoints) || 0) : 0,
                    totalPoints: Number(currentUser.totalPoints ?? currentUser.points) || 0,
                    dailyStreak: Number(currentUser.dailyStreak) || 0,
                    lastDailyDate: String(currentUser.lastDailyDate || ''),
                    weekId: curWeek
                };
            }
            const g = getGuestState();
            if (g.weekId !== curWeek) { g.weeklyPoints = 0; g.weekId = curWeek; saveGuestState(g); }
            return g;
        }

        function syncGamificationUI() {
            const stats = getEffectiveGamificationStats();
            const navPts = document.getElementById('navUserPoints');
            if (navPts) navPts.textContent = String(stats.weeklyPoints);
            const guestPts = document.getElementById('guestHeaderPoints');
            if (guestPts) guestPts.textContent = String(stats.weeklyPoints);
            const guestBannerPts = document.getElementById('guestBannerPts');
            if (guestBannerPts) guestBannerPts.textContent = String(stats.weeklyPoints);
            const chStreak = document.getElementById('chDailyStreak');
            if (chStreak) chStreak.textContent = `${stats.dailyStreak} 🔥`;
            const chWeekly = document.getElementById('chWeeklyPoints');
            if (chWeekly) chWeekly.textContent = `${stats.weeklyPoints} ⭐`;

            const myWeekly = document.getElementById('leagueMyWeeklyPts');
            if (myWeekly) myWeekly.textContent = String(stats.weeklyPoints);
            const myTotal = document.getElementById('leagueMyTotalPts');
            if (myTotal) myTotal.textContent = String(stats.totalPoints);
            const myLevel = document.getElementById('leagueMyLevelTitle');
            if (myLevel) myLevel.textContent = `اللقب: ${getRankLevelTitle(stats.totalPoints)}`;
            const myName = document.getElementById('leagueMyName');
            if (myName) myName.textContent = currentUser ? currentUser.username : 'أنت (ضيف)';

            const dailyDone = stats.lastDailyDate === getTodayDateKey();
            const dailyBadge = document.getElementById('dailyChallengeBadge');
            if (dailyBadge) {
                dailyBadge.textContent = dailyDone ? '✓ مكتمل اليوم' : '+30 نقطة';
                dailyBadge.className = dailyDone
                    ? 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold'
                    : 'text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-bold';
            }
            updateLeagueCountdown();
        }

        /* ---------- Guest Mode Navigation ---------- */
        function enterGuestChallenge(targetTab = 'challenge') {
            if (currentUser) { switchTab(targetTab === 'duel' ? 'challenge' : targetTab); return; }
            isGuestMode = true;
            document.getElementById('view-auth').classList.add('hidden');
            document.getElementById('appNav').classList.remove('hidden');
            document.getElementById('navGuestArea').classList.remove('hidden');
            document.getElementById('navGuestArea').classList.add('flex');
            document.getElementById('navUserArea').classList.add('hidden');
            document.getElementById('guestSaveBanner')?.classList.remove('hidden');
            syncGamificationUI();
            if (targetTab === 'league') {
                switchTab('league');
            } else {
                switchTab('challenge');
                if (targetTab === 'duel') startDuelMatch();
            }
        }

        function openAuthFromGuest() {
            hideAllViews();
            document.getElementById('view-auth').classList.remove('hidden');
            document.getElementById('usernameInput')?.focus();
        }

        /* ===================================================
           INFINITE QODRAT QUESTION GENERATOR (كمي + لفظي)
        =================================================== */
        function shuffleWithCorrect(correctVal, distractors) {
            const unique = [];
            const seen = new Set([String(correctVal)]);
            for (const d of distractors) {
                const s = String(d);
                if (!seen.has(s)) { seen.add(s); unique.push(s); }
                if (unique.length === 3) break;
            }
            let fallbackIdx = 1;
            while (unique.length < 3) {
                const cand = `${correctVal} (${fallbackIdx++})`;
                if (!seen.has(cand)) { seen.add(cand); unique.push(cand); }
            }
            const all = [String(correctVal), ...unique];
            for (let i = all.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [all[i], all[j]] = [all[j], all[i]];
            }
            return { options: all, correctIndex: all.indexOf(String(correctVal)) };
        }

        const VERBAL_POOL = [
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: غمد : سيف', correct: 'عرين : أسد', wrong: ['كتاب : ورقة', 'شجرة : غصن', 'بحر : سمك'], exp: 'الغمد هو بيت السيف ومكانه، والعرين هو بيت الأسد ومكانه.' },
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: رئة : تنفس', correct: 'معدة : هضم', wrong: ['عين : نظارة', 'أذن : صوت', 'يد : قلم'], exp: 'الرئة وظيفتها التنفس، والمعدة وظيفتها الهضم.' },
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: إهمال : فشل', correct: 'اجتهاد : نجاح', wrong: ['نوم : ليل', 'مرض : دواء', 'سرعة : سيارة'], exp: 'الإهمال يؤدي إلى الفشل (سبب ونتيجة)، والاجتهاد يؤدي إلى النجاح.' },
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: طبيب : مستشفى', correct: 'معلم : مدرسة', wrong: ['قلم : دفتر', 'نجار : خشب', 'مزارع : محصول'], exp: 'الطبيب يعمل في المستشفى، والمعلم يعمل في المدرسة.' },
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: كتاب : مكتبة', correct: 'شجرة : غابة', wrong: ['فصل : مدرسة', 'غرفة : بيت', 'إصبع : يد'], exp: 'مجموعة الكتب تكون مكتبة، ومجموعة الأشجار تكون غابة.' },
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: ليل : نهار', correct: 'أبيض : أسود', wrong: ['شمس : قمر', 'ماء : نار', 'سماء : أرض'], exp: 'الليل عكس النهار (تضاد)، والأبيض عكس الأسود.' },
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: بذرة : شجرة', correct: 'نواة : نخلة', wrong: ['ثمرة : زهرة', 'ورقة : غصن', 'ماء : نهر'], exp: 'البذرة تنمو فتصبح شجرة، والنواة تنمو فتصبح نخلة.' },
            { sub: 'تناظر لفظي', text: 'تناظر لفظي: قبطان : سفينة', correct: 'ربان : طائرة', wrong: ['سائق : طريق', 'مهندس : خريطة', 'جندي : معركة'], exp: 'القبطان يقود السفينة، والربان يقود الطائرة.' },
            { sub: 'إكمال الجمل', text: 'من لم يتعلم في صغره لم ........ في كبره.', correct: 'يتقدم', wrong: ['يتأخر', 'يندم', 'يتعب'], exp: 'حكمة مشهورة: من لم يتعلم في صغره لم يتقدم في كبره.' },
            { sub: 'إكمال الجمل', text: 'القراءة تمنح العقل ........ وتوسع ........ الإنسان.', correct: 'نضجاً - مدارك', wrong: ['ضعفاً - هموم', 'خمولاً - أحلام', 'تردداً - خطوات'], exp: 'القراءة تمنح العقل نضجاً وتوسع مدارك الإنسان.' },
            { sub: 'إكمال الجمل', text: 'لا تؤجل عمل ........ إلى ........ .', correct: 'اليوم - الغد', wrong: ['الأمس - اليوم', 'الليل - النهار', 'الصيف - الشتاء'], exp: 'المثل الشهير: لا تؤجل عمل اليوم إلى الغد.' },
            { sub: 'إكمال الجمل', text: 'الوقت كالسيف إن لم ........ قطعك.', correct: 'تقطعه', wrong: ['تحمله', 'تغسله', 'تبيعه'], exp: 'الحكمة المشهورة: الوقت كالسيف إن لم تقطعه قطعك.' },
            { sub: 'الخطأ السياقي', text: 'حدد الكلمة الخطأ سياقياً: "الصديق الحقيقي هو الذي يظهر معدنُه عند الرخاء لا الشدة."', correct: 'الرخاء', wrong: ['الحقيقي', 'معدنه', 'الشدة'], exp: 'الصواب: يظهر معدنه عند الشدة لا الرخاء.' },
            { sub: 'الخطأ السياقي', text: 'حدد الكلمة الخطأ سياقياً: "الكريم من يعطي وهو محتاج، والبخيل من يبخل وهو فقير."', correct: 'فقير', wrong: ['الكريم', 'محتاج', 'يبخل'], exp: 'الصواب: والبخيل من يبخل وهو غني.' },
            { sub: 'المفردة الشاذة', text: 'حدد المفردة الشاذة من بين الكلمات التالية:', correct: 'أسد', wrong: ['صقر', 'نسر', 'حمامة'], exp: 'الصقر والنسر والحمامة من الطيور، بينما الأسد من الثدييات.' },
            { sub: 'المفردة الشاذة', text: 'حدد المفردة الشاذة من بين الكلمات التالية:', correct: 'الرياض', wrong: ['مصر', 'السعودية', 'الأردن'], exp: 'مصر والسعودية والأردن دول، بينما الرياض عاصمة.' }
        ];

        function generateQuantQuestion() {
            const generators = [
                // 1. النسب المئوية
                () => {
                    const pct = [10, 15, 20, 25, 30, 40, 50][Math.floor(Math.random() * 7)];
                    const base = [80, 100, 120, 160, 200, 240, 300, 400][Math.floor(Math.random() * 8)];
                    const ans = (pct * base) / 100;
                    const { options, correctIndex } = shuffleWithCorrect(ans, [ans + 10, Math.max(5, ans - 10), base - ans]);
                    return { category: 'quant', sub: 'نسب مئوية', text: `ما قيمة ${pct}% من العدد ${base}؟`, options, correctIndex, explanation: `(${pct} ÷ 100) × ${base} = ${ans}.` };
                },
                // 2. السرعة والمسافة والزمن
                () => {
                    const speed = [60, 80, 90, 100, 120][Math.floor(Math.random() * 5)];
                    const mins = [20, 30, 40, 45][Math.floor(Math.random() * 4)];
                    const dist = (speed * mins) / 60;
                    const { options, correctIndex } = shuffleWithCorrect(`${dist} كم`, [`${dist + 15} كم`, `${Math.max(10, dist - 15)} كم`, `${speed} كم`]);
                    return { category: 'quant', sub: 'سرعة ومسافة', text: `سيارة تسير بسرعة ${speed} كم/ساعة، فكم كيلومتراً تقطع في ${mins} دقيقة؟`, options, correctIndex, explanation: `نحوّل الدقائق لساعات: ${mins} ÷ 60 ساعة. المسافة = ${speed} × (${mins}/60) = ${dist} كم.` };
                },
                // 3. المتوسط الحسابي
                () => {
                    const n = [4, 5, 6, 8][Math.floor(Math.random() * 4)];
                    const avg = [12, 15, 18, 20, 25][Math.floor(Math.random() * 5)];
                    const sum = n * avg;
                    const { options, correctIndex } = shuffleWithCorrect(sum, [sum + avg, Math.max(10, sum - avg), n + avg]);
                    return { category: 'quant', sub: 'متوسط حسابي', text: `إذا كان المتوسط الحسابي لـ ${n} أعداد هو ${avg}، فما مجموع هذه الأعداد؟`, options, correctIndex, explanation: `المجموع = المتوسط الحسابي × عدد الأعداد = ${avg} × ${n} = ${sum}.` };
                },
                // 4. هندسة (مربع / مثلث)
                () => {
                    const side = [4, 5, 6, 7, 8, 9, 10][Math.floor(Math.random() * 7)];
                    const area = side * side;
                    const perim = side * 4;
                    const { options, correctIndex } = shuffleWithCorrect(`${perim} سم`, [`${side * 2} سم`, `${area} سم`, `${perim + 4} سم`]);
                    return { category: 'quant', sub: 'هندسة', text: `مربع مساحته ${area} سم²، فما محيطه؟`, options, correctIndex, explanation: `طول ضلع المربع = √${area} = ${side} سم، والمحيط = 4 × ${side} = ${perim} سم.` };
                },
                // 5. الفرق بين مربعين
                () => {
                    const sum = [8, 10, 12, 14, 16][Math.floor(Math.random() * 5)];
                    const diff = [2, 3, 4, 5][Math.floor(Math.random() * 4)];
                    const ans = sum * diff;
                    const { options, correctIndex } = shuffleWithCorrect(ans, [sum + diff, ans + 8, Math.max(4, ans - 6)]);
                    return { category: 'quant', sub: 'جبر', text: `إذا كان س + ص = ${sum}، و س - ص = ${diff}، فما قيمة س² - ص²؟`, options, correctIndex, explanation: `س² - ص² = (س + ص)(س - ص) = ${sum} × ${diff} = ${ans}.` };
                },
                // 6. التناسب العكسي (عمال وأيام)
                () => {
                    const workers1 = [2, 3, 4][Math.floor(Math.random() * 3)];
                    const mult = [2, 3][Math.floor(Math.random() * 2)];
                    const workers2 = workers1 * mult;
                    const days2 = [3, 4, 5, 6][Math.floor(Math.random() * 4)];
                    const days1 = days2 * mult;
                    const { options, correctIndex } = shuffleWithCorrect(`${days2} أيام`, [`${days1 * mult} يوماً`, `${days2 + 2} أيام`, `${Math.max(1, days2 - 1)} أيام`]);
                    return { category: 'quant', sub: 'تناسب عكسي', text: `إذا كان ${workers1} عمال ينجزون عملاً في ${days1} يوماً، فكم يوماً يحتاج ${workers2} عمال لإنجاز العمل نفسه؟`, options, correctIndex, explanation: `تناسب عكسي: (${workers1} × ${days1}) ÷ ${workers2} = ${days2} أيام.` };
                }
            ];
            return generators[Math.floor(Math.random() * generators.length)]();
        }

        function generateVerbalQuestion() {
            const item = VERBAL_POOL[Math.floor(Math.random() * VERBAL_POOL.length)];
            const { options, correctIndex } = shuffleWithCorrect(item.correct, item.wrong);
            return { category: 'verbal', sub: item.sub, text: item.text, options, correctIndex, explanation: item.exp };
        }

        /* ---------- أسئلة الملف الخارجي (questions.json) ---------- */
        const FILE_LETTERS = ['أ', 'ب', 'ج', 'د'];
        let fileQuestions = [];
        let fileQuestionDeck = [];

        async function loadFileQuestions() {
            try {
                const res = await fetch('questions.json', { cache: 'no-cache' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                fileQuestions = (Array.isArray(data) ? data : []).filter(q =>
                    q && q.text && Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3);
            } catch (err) {
                console.warn('تعذر تحميل questions.json (شغّل الموقع من خادم/GitHub Pages وليس file://):', err);
                fileQuestions = [];
            }
        }
        loadFileQuestions();

        function shuffleArray(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        function toBankShape(f) {
            return {
                category: 'quant',
                sub: `من ملف الأسئلة • ص ${f.page || '?'}`,
                text: f.text,
                options: FILE_LETTERS.map(l => `الخيار ${l}`),
                correctIndex: f.correctIndex,
                explanation: `الإجابة الصحيحة: ${FILE_LETTERS[f.correctIndex]}`,
                letterOnly: true,
                fromFile: true
            };
        }

        // «كيس» عشوائي: يمر على كل الأسئلة مرة بترتيب مختلف قبل أن يعيد الخلط، فلا يتكرر سؤال قريباً.
        function nextFileQuestion() {
            if (!fileQuestions.length) return null;
            if (!fileQuestionDeck.length) fileQuestionDeck = shuffleArray([...fileQuestions]);
            return toBankShape(fileQuestionDeck.pop());
        }

        function generateChallengeQuestion(cat = 'all') {
            const pickCat = cat === 'all' ? (Math.random() < 0.55 ? 'quant' : 'verbal') : cat;
            if (pickCat === 'quant') {
                // أغلب الأسئلة الكمية تأتي من الملف عشوائياً، والباقي مولَّد بأرقام متجددة.
                if (fileQuestions.length && Math.random() < 0.75) return nextFileQuestion();
                return generateQuantQuestion();
            }
            return generateVerbalQuestion();
        }

        /* ===================================================
           ARENA ENGINE (DUEL / DAILY / ENDLESS)
        =================================================== */
        let duelCategory = 'all';
        let arenaMode = null; // 'duel' | 'daily' | 'endless'
        let arenaCurrentQ = null;
        let arenaAnswered = false;
        let arenaStartTime = 0;
        let arenaTimerInterval = null;

        // Duel state
        let duelRound = 0;
        const DUEL_TOTAL_ROUNDS = 5;
        let duelMyScore = 0;
        let duelBotScore = 0;
        let duelBotTimeout = null;
        let duelBotAnsweredRound = false;
        let duelBotCorrectRound = false;

        function setDuelCategory(cat) {
            duelCategory = cat;
            ['all', 'quant', 'verbal'].forEach(c => {
                const btn = document.getElementById(`dcat-${c}`);
                if (!btn) return;
                btn.classList.toggle('btn-primary', c === cat);
                btn.classList.toggle('bg-slate-800', c !== cat);
                btn.classList.toggle('text-slate-300', c !== cat);
            });
        }

        function stopArenaTimers() {
            if (arenaTimerInterval) { clearInterval(arenaTimerInterval); arenaTimerInterval = null; }
            if (duelBotTimeout) { clearTimeout(duelBotTimeout); duelBotTimeout = null; }
        }

        function startArenaTimer() {
            stopArenaTimers();
            arenaStartTime = Date.now();
            const timerEl = document.getElementById('arenaTimer');
            if (timerEl) timerEl.textContent = '00s';
            arenaTimerInterval = setInterval(() => {
                const sec = Math.floor((Date.now() - arenaStartTime) / 1000);
                if (timerEl) timerEl.textContent = `${String(sec).padStart(2, '0')}s`;
            }, 500);
        }

        function exitArena() {
            stopArenaTimers();
            arenaMode = null;
            document.getElementById('arenaActiveCard')?.classList.add('hidden');
            document.getElementById('duelResultCard')?.classList.add('hidden');
            document.getElementById('challengeModeSelector')?.classList.remove('hidden');
        }

        function startDuelMatch() {
            arenaMode = 'duel';
            duelRound = 0;
            duelMyScore = 0;
            duelBotScore = 0;
            document.getElementById('challengeModeSelector')?.classList.add('hidden');
            document.getElementById('duelResultCard')?.classList.add('hidden');
            document.getElementById('arenaActiveCard')?.classList.remove('hidden');
            document.getElementById('duelScoreHeader')?.classList.remove('hidden');
            document.getElementById('duelPlayerName').textContent = currentUser ? currentUser.username : 'أنت';
            nextDuelRound();
        }

        function nextDuelRound() {
            duelRound++;
            if (duelRound > DUEL_TOTAL_ROUNDS) {
                finishDuelMatch();
                return;
            }
            document.getElementById('duelRoundLabel').textContent = `الجولة ${duelRound} / ${DUEL_TOTAL_ROUNDS}`;
            document.getElementById('duelPlayerScore').textContent = String(duelMyScore);
            document.getElementById('duelBotScore').textContent = String(duelBotScore);
            document.getElementById('duelBotStatus').textContent = 'المنافس يقرأ السؤال...';
            duelBotAnsweredRound = false;
            duelBotCorrectRound = false;

            const q = generateChallengeQuestion(duelCategory);
            renderArenaQuestion(q);

            // Simulate bot thinking time (5s - 13s)
            const botDelay = 5000 + Math.floor(Math.random() * 8000);
            duelBotTimeout = setTimeout(() => {
                if (arenaMode !== 'duel' || duelBotAnsweredRound) return;
                duelBotAnsweredRound = true;
                duelBotCorrectRound = Math.random() < 0.68;
                if (duelBotCorrectRound) {
                    duelBotScore += 10;
                    document.getElementById('duelBotScore').textContent = String(duelBotScore);
                    document.getElementById('duelBotStatus').innerHTML = '<span class="text-emerald-400 font-bold">✓ المنافس أجاب إجابة صحيحة (+10)</span>';
                } else {
                    document.getElementById('duelBotStatus').innerHTML = '<span class="text-red-400">✗ المنافس أخطأ في الإجابة</span>';
                }
            }, botDelay);
        }

        function finishDuelMatch() {
            stopArenaTimers();
            document.getElementById('arenaActiveCard')?.classList.add('hidden');
            const resCard = document.getElementById('duelResultCard');
            resCard?.classList.remove('hidden');

            const won = duelMyScore > duelBotScore;
            const tie = duelMyScore === duelBotScore;
            const bonus = won ? 50 : (tie ? 20 : 10);
            const totalEarned = duelMyScore + bonus;

            document.getElementById('duelResultIcon').textContent = won ? '🏆' : (tie ? '🤝' : '💪');
            document.getElementById('duelResultTitle').textContent = won ? 'مبروك! فزت بالمبارزة!' : (tie ? 'تعادل مثير!' : 'حظ أوفر في الجولة القادمة!');
            document.getElementById('duelResultSubtitle').textContent = won
                ? `تفوقت على منافسك وحصلت على +50 نقطة مكافأة الفوز!`
                : `حصلت على نقاط إجاباتك بالإضافة لمكافأة المشاركة.`;
            document.getElementById('duelFinalMyScore').textContent = String(duelMyScore);
            document.getElementById('duelFinalBotScore').textContent = String(duelBotScore);
            document.getElementById('duelFinalEarned').textContent = `+${totalEarned}`;

            if (won) playGameSFX('win');
            awardGamificationPoints(totalEarned, { duelWon: won });
        }

        function startDailyChallenge() {
            const stats = getEffectiveGamificationStats();
            const alreadyDone = stats.lastDailyDate === getTodayDateKey();
            if (alreadyDone) {
                showToast('تحدي اليوم مكتمل ✅', 'لقد حللت سؤال اليوم بالفعل! عد غداً لسؤال جديد أو ابدأ مبارزة.');
            }
            arenaMode = 'daily';
            document.getElementById('challengeModeSelector')?.classList.add('hidden');
            document.getElementById('duelResultCard')?.classList.add('hidden');
            document.getElementById('arenaActiveCard')?.classList.remove('hidden');
            document.getElementById('duelScoreHeader')?.classList.add('hidden');
            const q = generateChallengeQuestion(duelCategory);
            q.sub = 'تحدي اليوم 🌟';
            renderArenaQuestion(q);
        }

        function startEndlessPractice() {
            arenaMode = 'endless';
            document.getElementById('challengeModeSelector')?.classList.add('hidden');
            document.getElementById('duelResultCard')?.classList.add('hidden');
            document.getElementById('arenaActiveCard')?.classList.remove('hidden');
            document.getElementById('duelScoreHeader')?.classList.add('hidden');
            renderArenaQuestion(generateChallengeQuestion(duelCategory));
        }

        function renderArenaQuestion(q) {
            arenaCurrentQ = q;
            arenaAnswered = false;
            document.getElementById('arenaBadgeCat').textContent = q.category === 'quant' ? 'كمي' : 'لفظي';
            document.getElementById('arenaBadgeSub').textContent = q.sub;
            document.getElementById('arenaQuestionText').textContent = q.text;
            document.getElementById('arenaFeedbackBox').classList.add('hidden');
            document.getElementById('arenaMistakeSavedNote').classList.add('hidden');
            document.getElementById('arenaNextBtn').classList.add('hidden');

            const container = document.getElementById('arenaOptionsContainer');
            container.innerHTML = '';
            q.options.forEach((opt, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'duel-opt-btn w-full p-3.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-right text-xs font-semibold transition flex items-center justify-between';
                btn.innerHTML = `<span>${q.letterOnly ? 'الاختيار (' + FILE_LETTERS[idx] + ')' : ['أ', 'ب', 'ج', 'د'][idx] + ' - ' + escapeHTML(opt)}</span><span class="opt-status"></span>`;
                btn.onclick = () => submitArenaAnswer(idx);
                container.appendChild(btn);
            });
            startArenaTimer();
        }

        async function submitArenaAnswer(selectedIdx) {
            if (arenaAnswered || !arenaCurrentQ) return;
            arenaAnswered = true;
            const elapsedSec = (Date.now() - arenaStartTime) / 1000;
            if (arenaTimerInterval) { clearInterval(arenaTimerInterval); arenaTimerInterval = null; }

            const q = arenaCurrentQ;
            const isCorrect = selectedIdx === q.correctIndex;
            const buttons = document.querySelectorAll('#arenaOptionsContainer .duel-opt-btn');

            buttons.forEach((b, idx) => {
                b.disabled = true;
                if (idx === q.correctIndex) {
                    b.classList.remove('bg-slate-900', 'border-slate-700');
                    b.classList.add('bg-emerald-950/60', 'border-emerald-500', 'text-emerald-200');
                    b.querySelector('.opt-status').innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i>';
                } else if (idx === selectedIdx && !isCorrect) {
                    b.classList.remove('bg-slate-900', 'border-slate-700');
                    b.classList.add('bg-red-950/60', 'border-red-500', 'text-red-200');
                    b.querySelector('.opt-status').innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400"></i>';
                }
            });

            const fb = document.getElementById('arenaFeedbackBox');
            const fbTitle = document.getElementById('arenaFeedbackTitle');
            const fbExp = document.getElementById('arenaFeedbackExp');
            fb.classList.remove('hidden', 'bg-emerald-950/40', 'border-emerald-500/50', 'bg-red-950/40', 'border-red-500/50');

            if (isCorrect) {
                playGameSFX('correct');
                const speedBonus = elapsedSec <= 12 ? 5 : 0;
                if (arenaMode === 'duel') {
                    const roundPts = 10 + speedBonus;
                    duelMyScore += roundPts;
                    document.getElementById('duelPlayerScore').textContent = String(duelMyScore);
                    fb.classList.add('bg-emerald-950/40', 'border-emerald-500/50');
                    fbTitle.textContent = `✅ أحسنت! +${roundPts} نقاط ${speedBonus ? '(+5 بونص سرعة ⚡)' : ''}`;
                } else if (arenaMode === 'daily') {
                    const stats = getEffectiveGamificationStats();
                    const firstToday = stats.lastDailyDate !== getTodayDateKey();
                    const pts = firstToday ? 30 : 10;
                    fb.classList.add('bg-emerald-950/40', 'border-emerald-500/50');
                    fbTitle.textContent = firstToday
                        ? `🔥 رائع! أكملت تحدي اليوم وحصلت على +${pts} نقطة!`
                        : `✅ إجابة صحيحة! (+${pts} نقاط تدريب)`;
                    await awardGamificationPoints(pts, { dailyCompleted: firstToday });
                } else {
                    const pts = 10 + speedBonus;
                    fb.classList.add('bg-emerald-950/40', 'border-emerald-500/50');
                    fbTitle.textContent = `✅ إجابة صحيحة! +${pts} نقاط ${speedBonus ? '(+5 بونص سرعة ⚡)' : ''}`;
                    await awardGamificationPoints(pts, {});
                }
            } else {
                playGameSFX('wrong');
                fb.classList.add('bg-red-950/40', 'border-red-500/50');
                fbTitle.textContent = '❌ إجابة غير صحيحة! راجع طريقة الحل:';
                // Auto-save mistake into "أخطائي" folder for logged-in users
                if (currentUser && !isGuestMode) {
                    const saved = await autoSaveMistakeToFolder(q);
                    if (saved) document.getElementById('arenaMistakeSavedNote')?.classList.remove('hidden');
                }
            }

            fbExp.textContent = q.explanation;
            const nextBtn = document.getElementById('arenaNextBtn');
            nextBtn.classList.remove('hidden');
            nextBtn.innerHTML = arenaMode === 'duel'
                ? (duelRound >= DUEL_TOTAL_ROUNDS ? 'عرض نتيجة المبارزة <i class="fa-solid fa-trophy"></i>' : 'الجولة التالية <i class="fa-solid fa-arrow-left"></i>')
                : (arenaMode === 'daily' ? 'انتقل لمبارزة سريعة <i class="fa-solid fa-bolt"></i>' : 'السؤال التالي <i class="fa-solid fa-arrow-left"></i>');
        }

        function handleArenaNext() {
            if (arenaMode === 'duel') nextDuelRound();
            else if (arenaMode === 'daily') startDuelMatch();
            else renderArenaQuestion(generateChallengeQuestion(duelCategory));
        }

        /* ===================================================
           AUTO-SAVE MISTAKES INTO "أخطائي" FOLDER
        =================================================== */
        async function autoSaveMistakeToFolder(q) {
            if (!currentUser?.uid) return false;
            const folderName = 'أخطائي';
            let foldersChanged = false;
            if (!folders.some(f => f.category === q.category && f.name === folderName)) {
                folders = [...folders, { id: 'f_err_' + q.category + '_' + Date.now(), name: folderName, category: q.category }];
                foldersChanged = true;
            }
            if (questions.some(item => item.text === q.text && item.folder === folderName)) {
                return true;
            }
            const catQs = questions.filter(item => item.category === q.category);
            const num = catQs.reduce((m, item) => Math.max(m, Number(item.num) || 0), 0) + 1;
            const newQ = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                num,
                category: q.category,
                folder: folderName,
                text: q.text,
                options: [...q.options],
                correctIndex: q.correctIndex,
                explanation: q.explanation,
                imageUrl: null
            };
            const prevQs = questions;
            const prevFolders = folders;
            questions = [...questions, newQ];
            try {
                await saveStateToStorage();
                updateDashboardStats();
                if (foldersChanged) updateFolderOptionsInModal();
                return true;
            } catch (err) {
                console.warn('Auto-save mistake failed:', err);
                questions = prevQs;
                folders = prevFolders;
                return false;
            }
        }

        /* ===================================================
           POINTS & STREAK PERSISTENCE (GUEST + FIRESTORE)
        =================================================== */
        async function awardGamificationPoints(pointsToAdd, opts = {}) {
            const pts = Number(pointsToAdd) || 0;
            const curWeek = getCurrentWeekId();
            const today = getTodayDateKey();
            const yesterday = getYesterdayDateKey();

            if (!currentUser || isGuestMode) {
                const g = getGuestState();
                if (g.weekId !== curWeek) { g.weeklyPoints = 0; g.weekId = curWeek; }
                g.weeklyPoints += pts;
                g.totalPoints += pts;
                if (opts.duelWon) g.duelsWon = (g.duelsWon || 0) + 1;
                if (opts.dailyCompleted && g.lastDailyDate !== today) {
                    g.dailyStreak = (g.lastDailyDate === yesterday) ? (g.dailyStreak + 1) : 1;
                    g.lastDailyDate = today;
                }
                saveGuestState(g);
                syncGamificationUI();
                return;
            }

            const sameWeek = currentUser.weekId === curWeek;
            const nextWeekly = (sameWeek ? (Number(currentUser.weeklyPoints) || 0) : 0) + pts;
            const nextTotal = (Number(currentUser.totalPoints ?? currentUser.points) || 0) + pts;
            let nextStreak = Number(currentUser.dailyStreak) || 0;
            let nextLastDaily = String(currentUser.lastDailyDate || '');
            if (opts.dailyCompleted && nextLastDaily !== today) {
                nextStreak = (nextLastDaily === yesterday) ? (nextStreak + 1) : 1;
                nextLastDaily = today;
            }

            currentUser.weekId = curWeek;
            currentUser.weeklyPoints = nextWeekly;
            currentUser.totalPoints = nextTotal;
            currentUser.points = nextTotal;
            currentUser.dailyStreak = nextStreak;
            currentUser.lastDailyDate = nextLastDaily;
            syncGamificationUI();

            try {
                await window.firebaseAPI?.updateGamificationStats?.({
                    weekId: curWeek,
                    weeklyPoints: nextWeekly,
                    totalPoints: nextTotal,
                    dailyStreak: nextStreak,
                    lastDailyDate: nextLastDaily,
                    duelWon: !!opts.duelWon
                });
            } catch (err) {
                console.warn('Cloud gamification sync warning:', err);
            }
        }

        /* ===================================================
           WEEKLY LEAGUE LEADERBOARD
        =================================================== */
        async function refreshPermanentLeague() {
            const container = document.getElementById('permanentLeagueContainer');
            if (!container) return;
            syncGamificationUI();
            container.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل ترتيب دوري قُدراتي العام...</div>';
            try {
                let rows = [];
                if (window.firebaseAPI?.getPermanentLeaderboard) {
                    rows = await window.firebaseAPI.getPermanentLeaderboard(25);
                }
                // Include guest entry in preview if guest has points
                if ((!currentUser || isGuestMode)) {
                    const g = getGuestState();
                    if (g.totalPoints > 0) {
                        rows.push({ uid: 'guest_me', username: 'أنت (ضيف - سجّل لحفظ ترتيبك)', weeklyPoints: g.weeklyPoints, totalPoints: g.totalPoints, isGuest: true });
                    }
                }
                rows.sort((a, b) => (Number(b.totalPoints) || 0) - (Number(a.totalPoints) || 0));

                if (!rows.length) {
                    container.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs">لم يجمع أحد نقاطاً بعد. ابدأ أول مبارزة وتصدّر الدوري!</div>';
                    return;
                }

                let myRank = null;
                container.innerHTML = rows.map((u, idx) => {
                    const rank = idx + 1;
                    const isMe = (currentUser && u.uid === currentUser.uid) || u.isGuest;
                    if (isMe) myRank = rank;
                    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
                    const wPts = Number(u.totalPoints) || 0;
                    const tPts = Number(u.totalPoints ?? u.points) || wPts;
                    const cardCls = isMe
                        ? 'bg-sky-950/60 border-sky-500'
                        : rank <= 3
                            ? 'bg-amber-950/20 border-amber-500/40'
                            : 'bg-slate-900/60 border-slate-800';
                    return `
                        <div class="p-3 rounded-xl border ${cardCls} flex items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="w-8 h-8 rounded-lg bg-slate-800 font-black text-sm flex items-center justify-center shrink-0">${medal}</div>
                                <div class="min-w-0">
                                    <div class="font-bold text-sm truncate">${escapeHTML(u.username || 'طالب')} ${isMe ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-sky-600 text-white mr-1">أنت</span>' : ''}</div>
                                    <div class="text-[11px] text-slate-400">${getRankLevelTitle(tPts)}</div>
                                </div>
                            </div>
                            <div class="text-left shrink-0">
                                <div class="font-black text-sm text-amber-400">${wPts} <span class="text-[10px] font-normal text-slate-400">نقطة</span></div>
                            </div>
                        </div>`;
                }).join('');

                const rankBadge = document.getElementById('leagueMyRankBadge');
                if (rankBadge) rankBadge.textContent = myRank ? `#${myRank}` : '-';
            } catch (err) {
                console.error('Weekly league error:', err);
                container.innerHTML = '<div class="text-center py-8 text-red-400 text-xs">تعذر تحميل جدول الدوري. تأكد من صلاحيات قراءة users في Firestore Rules.</div>';
            }
        }

        function getLocalUsers() { return []; } // لم تعد الحسابات المحلية مستخدمة.



    
