import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail, sendEmailVerification, deleteUser } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getDatabase, ref, onValue, set, get, update, query, orderByChild, equalTo, push, serverTimestamp, off, limitToLast } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-functions.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
// Initialize functions (region: asia-south1)
const functions = getFunctions(app, 'asia-south1');

// --- DOM Element variables (MODIFIED) ---
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const dashboard = document.getElementById('dashboard');
const childListContainer = document.getElementById('child-list-container'); // Changed from userList
const mainContentTitle = document.getElementById('main-content-title');
const detailsView = document.getElementById('details-view');
const categoryButtonsContainer = document.querySelector('.category-buttons');

const overlay = document.getElementById('overlay');

const dataPageView = document.getElementById('data-page-view');
const dataPageTitle = document.getElementById('data-page-title');
const dataPageContent = document.getElementById('data-page-content');
const dashboardView = document.getElementById('dashboard-view');

const errorMessage = document.getElementById('error-message');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginTabBtn = document.getElementById('login-tab-btn');
const signupTabBtn = document.getElementById('signup-tab-btn');
const submitAuthBtn = document.getElementById('submit-auth-btn');
const submitAuthBtnText = document.getElementById('submit-auth-btn-text');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const comingSoonModal = document.getElementById('coming-soon-modal');
const comingSoonTitle = document.getElementById('coming-soon-title');
const offlineBanner = document.getElementById('offline-banner');

const adminNotificationModal = document.getElementById('admin-notification-modal');
const adminNotificationText = document.getElementById('admin-notification-text');
const adminNotificationOkBtn = document.getElementById('admin-notification-ok-btn');

const liveChatBtn = document.getElementById('live-chat-btn');
const chatModal = document.getElementById('chat-modal');

const infoNotificationModal = document.getElementById('info-notification-modal');
const infoModalText = document.getElementById('info-modal-text');

const deleteAccountBtn = document.getElementById('delete-account-btn');
const deleteAccountModal = document.getElementById('delete-account-modal');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

const infoAccessibilityModal = document.getElementById('info-accessibility-modal');

const verificationContainer = document.getElementById('verification-container');
const verificationEmailSpan = document.getElementById('verification-email');
const resendVerificationBtn = document.getElementById('resend-verification-btn');
const infoNoticeBox = document.getElementById('info-notice-box');
const downloadNoticeBox = document.getElementById('download-notice-box');

const homeBrandLink = document.getElementById('home-brand-link');

// New Navbar elements
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileNavDropdown = document.getElementById('mobile-nav-dropdown');
const desktopNavLinks = document.querySelector('.desktop-nav-links');
const notificationBellBtn = document.getElementById('notification-bell-btn');
const notificationCount = document.getElementById('notification-count');
const notificationDropdown = document.getElementById('notification-dropdown');
const notificationDropdownList = document.getElementById('notification-dropdown-list');

let authMode = 'login';
let activeDataListener = null;
let activeNotificationListener = null;
let activeChatListener = null;
let selectedChildInfo = {};
let currentNotificationRef = null;
let freezeStatusListener = null; // listener for profile_data/security/is_frozen

// --- LAZY LOADING VARIABLES (NEW) ---
let fullKeyloggerData = [], renderedKeyloggerCount = 0, isKeyloggerLoading = false;
let fullSmsData = [], renderedSmsCount = 0, isSmsLoading = false;
let fullCallLogData = [], renderedCallLogCount = 0, isCallLogLoading = false;
let fullNotificationData = [], renderedNotificationCount = 0, isNotificationLoading = false;

const DATA_BATCH_SIZE = 50; // Universal batch size

let isPhotoCommandRunning = false;
let isVideoCommandRunning = false;
let isAudioCommandRunning = false;

// --- AD FUNCTIONS (MODIFIED) ---
function getAdPlaceholderHtml(uniqueId) {
    // Use ad-320x50 for list-based data
    return `<div id="${uniqueId}" class="ad-container ad-320x50"></div>`;
}

function loadBannerAd(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (container.querySelector('iframe')) return; // Don't reload if already loaded

    container.innerHTML = ''; 

    const script1 = document.createElement('script');
    script1.type = 'text/javascript';
    script1.text = `
        atOptions = {
            'key' : '3fdc31da6152751e5c6f9e26dadb6d23',
            'format' : 'iframe',
            'height' : 50,
            'width' : 320,
            'params' : {}
        };
    `;

    const script2 = document.createElement('script');
    script2.type = 'text/javascript';
    script2.src = '//www.highperformanceformat.com/3fdc31da6152751e5c6f9e26dadb6d23/invoke.js';

    container.appendChild(script1);
    container.appendChild(script2);
}
// --- AD FUNCTIONS END ---

// --- NAVIGATION AND VIEW FUNCTIONS (NEW/MODIFIED) ---

function showView(viewId, pushState = true, stateData = {}) {
    document.querySelectorAll('.content-view').forEach(view => {
        view.classList.remove('active');
    });
    const activeView = document.getElementById(viewId);
    if(activeView) {
        activeView.classList.add('active');
    }
    
    // Detach scroll listeners when leaving data view
    if (viewId !== 'data-page-view') {
        detachScrollListeners();
    }

    if (pushState) {
        const state = { view: viewId, ...stateData };
        let hash = `#${viewId}`;
        if (state.childKey) hash = `#${state.childKey}`;
        if (state.category) hash = `#${state.childKey}/${state.category}`;
        
        // Only push if state is different
        if (JSON.stringify(history.state) !== JSON.stringify(state)) {
            history.pushState(state, "", hash);
        }
    }
}

// Handle Browser Back/Forward
window.addEventListener('popstate', (event) => {
    if (event.state) {
        handleStateChange(event.state);
    } else {
        // This handles going back to the very first page (no state)
        handleStateChange({ view: 'dashboard-view' });
    }
});

function handleStateChange(state) {
    if (!state) state = { view: 'dashboard-view' };

    switch (state.view) {
        case 'data-page-view':
            if (state.childKey && state.category) {
                // Ensure correct child is selected (in case of deep link)
                selectedChildInfo = { ...selectedChildInfo, childKey: state.childKey };
                openDataPage(state.category, false); // false = don't push state
            } else {
                // Fallback to dashboard
                showDashboardHome(false);
            }
            break;
        case 'details-view':
            if (state.childKey) {
                selectedChildInfo = { ...selectedChildInfo, childKey: state.childKey };
                showFeatureDashboard(false); // false = don't push state
            } else {
                showDashboardHome(false);
            }
            break;
        case 'dashboard-view':
        default:
            showDashboardHome(false); // false = don't push state
            break;
    }
}

// Show main child list
function showDashboardHome(pushState = true) {
    mainContentTitle.textContent = 'Select Child';
    childListContainer.style.display = 'grid';
    verificationContainer.style.display = 'block'; // Let manageVerificationUI handle this
    detailsView.style.display = 'none';
    if (auth.currentUser) manageVerificationUI(auth.currentUser); // Re-check verification UI
    // Ensure we monitor account freeze status when showing dashboard
    if (auth.currentUser) setupFreezeStatusListener(auth.currentUser.uid);
    
    showView('dashboard-view', pushState, { view: 'dashboard-view' });
}

// Show features for a selected child
function showFeatureDashboard(pushState = true) {
    if (!selectedChildInfo.childKey) {
        showDashboardHome();
        return;
    }
    mainContentTitle.textContent = selectedChildInfo.userName || 'Dashboard';
    childListContainer.style.display = 'none';
    verificationContainer.style.display = 'none';
    detailsView.style.display = 'block';
    
    showView('dashboard-view', pushState, { view: 'details-view', childKey: selectedChildInfo.childKey });
}

// Open the final data page (SMS, Photos, etc.)
function openDataPage(category, pushState = true) { 
    dataPageTitle.textContent = getSafeCategoryName(category);
    // Pass pushState to showView
    showView('data-page-view', pushState, { 
        view: 'data-page-view', 
        childKey: selectedChildInfo.childKey, 
        category: category 
    });
    displayCategoryData(category);
}

// Home brand link click handler
homeBrandLink.addEventListener('click', (e) => {
    e.preventDefault();
    showDashboardHome(true); // Always push state when clicking home
});

// --- END NAVIGATION FUNCTIONS ---


// --- NAVBAR/MENU LOGIC (NEW) ---
function setupMobileMenu() {
    // Clone desktop links into mobile dropdown
    const linksToClone = desktopNavLinks.querySelectorAll('.action-btn');
    linksToClone.forEach(link => {
        mobileNavDropdown.appendChild(link.cloneNode(true));
    });
    
    // Re-bind listeners for cloned buttons
    const mobileChatBtn = mobileNavDropdown.querySelector('#live-chat-btn');
    const mobileDeleteBtn = mobileNavDropdown.querySelector('#delete-account-btn');
    const mobileLogoutBtn = mobileNavDropdown.querySelector('#logout-btn');

    if (mobileChatBtn) mobileChatBtn.addEventListener('click', () => openChatModal());
    if (mobileDeleteBtn) mobileDeleteBtn.addEventListener('click', () => openModal(deleteAccountModal));
    if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', () => signOut(auth));
}

mobileMenuBtn.addEventListener('click', () => {
    mobileNavDropdown.classList.toggle('visible');
    notificationDropdown.classList.remove('visible'); // Close other dropdown
});

notificationBellBtn.addEventListener('click', () => {
    notificationDropdown.classList.toggle('visible');
    mobileNavDropdown.classList.remove('visible'); // Close other dropdown
});

// Close dropdowns if clicking outside
document.addEventListener('click', (e) => {
    if (!mobileMenuBtn.contains(e.target) && !mobileNavDropdown.contains(e.target)) {
        mobileNavDropdown.classList.remove('visible');
    }
    if (!notificationBellBtn.contains(e.target) && !notificationDropdown.contains(e.target)) {
        notificationDropdown.classList.remove('visible');
    }
});

// --- END NAVBAR LOGIC ---


loginTabBtn.addEventListener('click', () => { 
    authMode = 'login'; 
    loginTabBtn.classList.add('active'); 
    signupTabBtn.classList.remove('active'); 
    submitAuthBtnText.textContent = 'Login'; 
    errorMessage.textContent = ''; 
    forgotPasswordLink.style.display = 'block'; 
});

signupTabBtn.addEventListener('click', () => { 
    authMode = 'signup'; 
    signupTabBtn.classList.add('active'); 
    loginTabBtn.classList.remove('active'); 
    submitAuthBtnText.textContent = 'Sign Up'; 
    errorMessage.textContent = ''; 
    forgotPasswordLink.style.display = 'none'; 
});

submitAuthBtn.addEventListener('click', () => {
    const email = emailInput.value; 
    const password = passwordInput.value; 
    errorMessage.textContent = '';
    if (!email || !password) { 
        errorMessage.textContent = 'Please enter both email and password.'; 
        return; 
    }
    
    submitAuthBtn.disabled = true;
    submitAuthBtnText.textContent = 'Processing...';

    if (authMode === 'login') {
        signInWithEmailAndPassword(auth, email, password)
          .catch(error => { 
              errorMessage.textContent = getFriendlyAuthError(error.code); 
          })
          .finally(() => {
              submitAuthBtn.disabled = false;
              submitAuthBtnText.textContent = 'Login';
          });
    } else { // Signup mode
        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                sendEmailVerification(auth.currentUser)
                    .then(() => {
                        console.log("Verification email sent.");
                        // FEATURE 2: Show welcome toast instead of email alert
                        showToast('Account Created! Welcome to FamTool. Please check your dashboard bell icon for important alerts.');
                    });
            })
            .catch(error => { 
                errorMessage.textContent = getFriendlyAuthError(error.code); 
            })
            .finally(() => {
                 submitAuthBtn.disabled = false;
                 submitAuthBtnText.textContent = 'Sign Up';
            });
    }
});

resendVerificationBtn.addEventListener('click', () => {
    const user = auth.currentUser;
    if (user) {
        resendVerificationBtn.classList.add('clicked');
        sendEmailVerification(user)
            .then(() => {
                showToast('A new verification email has been sent to your inbox.');
            })
            .catch(error => {
                showToast(getFriendlyAuthError(error.code));
            });
        
        setTimeout(() => {
            resendVerificationBtn.classList.remove('clicked');
        }, 400);
    }
});

forgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    const email = emailInput.value;
    if (!email) {
        errorMessage.textContent = 'Please enter your email address to reset password.';
        return;
    }
    sendPasswordResetEmail(auth, email)
        .then(() => {
            showToast('Password reset email sent! Check your inbox.');
            errorMessage.textContent = '';
        })
        .catch((error) => {
            errorMessage.textContent = getFriendlyAuthError(error.code);
        });
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// --- FEATURE 1: Parent IP Tracking Function ---
async function logParentSession(uid) {
    try {
        // Fetch IP and location data
        const ipResponse = await fetch('https://ipapi.co/json/');
        const ipData = await ipResponse.json();
        
        // Extract device and browser info
        const userAgent = navigator.userAgent;
        const browserInfo = getBrowserInfo(userAgent);
        
        // Prepare payload
        const payload = {
            ip: ipData.ip,
            city: ipData.city,
            country: ipData.country_name,
            device: browserInfo.device,
            browser: browserInfo.browser,
            lat: ipData.latitude,
            lon: ipData.longitude
        };
        
        // Call Cloud Function
        const updateUserLocation = httpsCallable(functions, 'updateUserLocation');
        await updateUserLocation(payload);
        console.log('Parent session logged successfully');
    } catch (error) {
        console.error('Error logging parent session:', error);
    }
}

function getBrowserInfo(userAgent) {
    let browser = 'Unknown';
    let device = 'Unknown';
    
    // Simple browser detection
    if (userAgent.indexOf('Firefox') > -1) browser = 'Firefox';
    else if (userAgent.indexOf('Chrome') > -1) browser = 'Chrome';
    else if (userAgent.indexOf('Safari') > -1) browser = 'Safari';
    else if (userAgent.indexOf('Edge') > -1) browser = 'Edge';
    
    // Simple device detection
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent)) device = 'Mobile';
    else if (/tablet|ipad/i.test(userAgent)) device = 'Tablet';
    else device = 'Desktop';
    
    return { browser, device };
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        authContainer.style.display = 'none'; 
        appContainer.style.display = 'block';
        setupMobileMenu(); // Setup mobile menu on login
        
        // FEATURE 1: Log parent session with IP/Location
        logParentSession(user.uid);
        
        const verificationStatusRef = ref(db, `user/${user.uid}/profile/emailVerified`);
        set(verificationStatusRef, user.emailVerified);
        
        loadUserDevices(user.uid);
        
        // Check initial URL hash
        if (location.hash) {
            const hash = location.hash.substring(1);
            const parts = hash.split('/');
            const childKey = parts[0];
            const category = parts[1];
            
            if (category) {
                // Deep link to a data page
                selectedChildInfo = { userId: user.uid, childKey: childKey };
                openDataPage(category, false); // Don't push state, just load
            } else if (childKey) {
                // Deep link to a child's feature page
                selectedChildInfo = { userId: user.uid, childKey: childKey };
                showFeatureDashboard(false); // Don't push state, just load
            } else {
                showDashboardHome(false);
            }
        } else {
            showDashboardHome(false); // Show main dashboard
        }

    } else {
        authContainer.style.display = 'flex'; 
        appContainer.style.display = 'none';
        childListContainer.innerHTML = ''; 
        detailsView.style.display = 'none'; 
        mainContentTitle.textContent = 'Select a Device'; 
        liveChatBtn.disabled = true;
        if(activeDataListener) off(activeDataListener.ref);
        if(activeNotificationListener) off(activeNotificationListener.ref);
        if(activeChatListener) off(activeChatListener.ref);
        
        // FIX: Added try/catch block to handle SecurityError in iframe environments
        try {
            // Reset history to root
            history.replaceState(null, "", " ");
        } catch (e) {
            // Ignore SecurityError when running in restricted environments (like blob: URLs)
            console.warn("History API block detected:", e.message);
        }
    }
});

function manageVerificationUI(user) {
    const userDevicesRef = ref(db, `user/${user.uid}`);
    get(userDevicesRef).then((snapshot) => {
        const data = snapshot.val();
        const hasChildDevices = data && Object.keys(data).some(key => key !== 'profile');

        if (user.emailVerified) {
            verificationContainer.style.display = 'none';
        } else {
            verificationContainer.style.display = 'block'; // Make sure it's visible
            verificationEmailSpan.textContent = user.email;
            document.querySelector('#verification-container .notice-box.error').style.display = 'block';

            if (hasChildDevices) {
                // User has devices but is not verified
                infoNoticeBox.style.display = 'none';
                downloadNoticeBox.style.display = 'none';
            } else {
                // New user, not verified, no devices
                infoNoticeBox.style.display = 'block';
                downloadNoticeBox.style.display = 'block';
            }
        }
    });
}

// --- FREEZE STATUS / SECURITY UI ---
function disableCommandButtons() {
    const elems = document.querySelectorAll('.action-btn, .category-btn, [data-command]');
    elems.forEach(el => {
        try {
            el.disabled = true;
            el.classList.add('disabled');
        } catch (e) {}
    });
    // Also disable some global action buttons
    if (liveChatBtn) liveChatBtn.disabled = true;
    const mobileChatBtn = mobileNavDropdown ? mobileNavDropdown.querySelector('#live-chat-btn') : null;
    if (mobileChatBtn) mobileChatBtn.disabled = true;
}

function enableCommandButtons() {
    const elems = document.querySelectorAll('.action-btn, .category-btn, [data-command]');
    elems.forEach(el => {
        try {
            el.disabled = false;
            el.classList.remove('disabled');
        } catch (e) {}
    });
    if (liveChatBtn) liveChatBtn.disabled = false;
    const mobileChatBtn = mobileNavDropdown ? mobileNavDropdown.querySelector('#live-chat-btn') : null;
    if (mobileChatBtn) mobileChatBtn.disabled = false;
}

function showFrozenBanner() {
    let banner = document.getElementById('frozen-warning-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'frozen-warning-banner';
        // FEATURE 5: Enhanced frozen banner with larger size and better styling
        banner.style.background = 'linear-gradient(135deg, #c0392b 0%, #e74c3c 100%)';
        banner.style.color = '#fff';
        banner.style.padding = '20px 16px';
        banner.style.textAlign = 'center';
        banner.style.fontWeight = '700';
        banner.style.fontSize = '16px';
        banner.style.zIndex = '9999';
        banner.style.borderBottom = '3px solid #a93226';
        banner.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
        banner.style.animation = 'pulse-red 2s infinite';
        banner.innerHTML = '⚠️ Your account is currently FROZEN by Admin. You cannot perform any actions.';
        
        // Add CSS animation for the banner
        if (!document.getElementById('frozen-banner-style')) {
            const style = document.createElement('style');
            style.id = 'frozen-banner-style';
            style.textContent = `
                @keyframes pulse-red {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.9; }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Insert at top of dashboard view so it's prominent
        const dashboardView = document.getElementById('dashboard-view');
        if (dashboardView) {
            dashboardView.insertAdjacentElement('afterbegin', banner);
        } else if (appContainer) {
            appContainer.insertAdjacentElement('afterbegin', banner);
        } else {
            document.body.insertAdjacentElement('afterbegin', banner);
        }
    } else {
        banner.style.display = 'block';
    }
}

function hideFrozenBanner() {
    const banner = document.getElementById('frozen-warning-banner');
    if (banner) banner.style.display = 'none';
}

function setupFreezeStatusListener(uid) {
    if (!uid) return;
    // Detach previous listener if any
    try {
        if (freezeStatusListener && freezeStatusListener.ref) off(freezeStatusListener.ref);
    } catch (e) {
        console.warn('Error detaching previous freeze listener', e);
    }

    const freezeRef = ref(db, `user/${uid}/profile_data/security/is_frozen`);
    freezeStatusListener = { ref: freezeRef };

    onValue(freezeRef, (snapshot) => {
        const isFrozen = snapshot.val();
        if (isFrozen === true || String(isFrozen) === 'true') {
            console.warn('Account is frozen. Disabling actions.');
            showFrozenBanner();
            disableCommandButtons();
        } else {
            hideFrozenBanner();
            enableCommandButtons();
        }
    }, (error) => {
        console.error('Error reading freeze status:', error);
    });
}

deleteAccountBtn.addEventListener('click', () => openModal(deleteAccountModal));
cancelDeleteBtn.addEventListener('click', () => closeModal(deleteAccountModal));

confirmDeleteBtn.addEventListener('click', () => {
    const user = auth.currentUser;
    if (user) {
        deleteUser(user).then(() => {
            closeModal(deleteAccountModal);
            showToast('Account deleted successfully.');
        }).catch((error) => {
            console.error("Error deleting user:", error);
            if (error.code === 'auth/requires-recent-login') {
                showToast('This is a sensitive operation. Please log out and log back in again before deleting your account.');
            } else {
                showToast('An error occurred while deleting your account.');
            }
            closeModal(deleteAccountModal);
        });
    }
});

// --- LOAD USER DEVICES (MODIFIED) ---
function loadUserDevices(userId) {
    const usersRef = ref(db, `user/${userId}`);
    onValue(usersRef, (snapshot) => {
        childListContainer.innerHTML = ''; // Clear the container
        const data = snapshot.val();
        let hasDevices = false;
        if (data) {
            Object.keys(data).forEach(childKey => {
                if (childKey === 'profile') return;
                hasDevices = true;
                const childData = data[childKey]; 
                const userName = childData?.data?.nameChild || childKey; 
                const deviceName = childData?.data?.nameDevice || 'Unknown Device'; 
                
                // New Card HTML
                const card = document.createElement('div');
                card.className = 'child-card'; 
                card.dataset.userid = userId; 
                card.dataset.childkey = childKey; 
                card.dataset.username = userName; 
                card.dataset.devicename = deviceName; 
                card.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    <div>
                        <div class="user-name">${userName}</div>
                        <div class="device-name">${deviceName}</div>
                    </div>`;
                childListContainer.appendChild(card);
            });
        } 
        if (!hasDevices) { 
            childListContainer.innerHTML = '<div class="no-devices-placeholder">No devices found. Please follow the instructions below to add a device.</div>'; 
        }
        
        // FEATURE 3: Load plan and usage info when devices are loaded
        if (data) {
            loadPlanInfoDisplay(userId);
        }
    });
}

// --- FEATURE 3: Plan & Usage Limits Display ---
function loadPlanInfoDisplay(userId) {
    const profileDataRef = ref(db, `user/${userId}/profile_data`);
    get(profileDataRef).then((snapshot) => {
        if (snapshot.exists()) {
            const profileData = snapshot.val();
            const accountType = profileData?.account_type || 'Free';
            const limits = profileData?.limits || {};
            
            // Update HTML elements
            const planTypeEl = document.getElementById('plan-type');
            const usagePhotosEl = document.getElementById('usage-photos');
            const usageVideosEl = document.getElementById('usage-videos');
            const planInfoSection = document.getElementById('plan-info-section');
            
            if (planTypeEl) planTypeEl.textContent = accountType;
            
            // Get current usage counts (or use limits as max if actual data not available)
            const maxPhotos = limits.photos_max || 5;
            const currentPhotos = limits.photos_used || 0;
            const maxVideos = limits.videos_max || 4;
            const currentVideos = limits.videos_used || 0;
            
            if (usagePhotosEl) usagePhotosEl.textContent = `${currentPhotos}/${maxPhotos}`;
            if (usageVideosEl) usageVideosEl.textContent = `${currentVideos}/${maxVideos}`;
            
            // Show the plan info section
            if (planInfoSection) planInfoSection.style.display = 'flex';
        }
    }).catch((error) => {
        console.error('Error loading plan info:', error);
    });
}

// --- CHILD CLICK LISTENER (MODIFIED) ---
childListContainer.addEventListener('click', (e) => {
    const card = e.target.closest('.child-card');
    if (card) {
        selectedChildInfo = { 
            userId: card.dataset.userid, 
            childKey: card.dataset.childkey, 
            userName: card.dataset.username, 
            deviceName: card.dataset.devicename 
        };
        
        liveChatBtn.disabled = false;
        // Also enable cloned mobile chat button
        const mobileChatBtn = mobileNavDropdown.querySelector('#live-chat-btn');
        if(mobileChatBtn) mobileChatBtn.disabled = false;

        // Setup listeners for this child
        setupNotificationListener(selectedChildInfo.userId, selectedChildInfo.childKey);
        setupAppVisibilityListener(selectedChildInfo.userId, selectedChildInfo.childKey);
        
        // Show the feature dashboard
        showFeatureDashboard(true); // true = push state
    }
});

// Setup visibility listener
function setupAppVisibilityListener(userId, childKey) {
    const appVisibilityRef = ref(db, `user/${userId}/${childKey}/data/showApp`);
    onValue(appVisibilityRef, (snapshot) => {
        const isVisible = snapshot.val();
        const statusElement = document.getElementById('app-visibility-status');
        const buttonElement = document.querySelector('[data-category="toggleAppVisibility"]');

        if (statusElement && buttonElement) {
            statusElement.textContent = isVisible ? 'Status: Visible' : 'Status: Hidden';
            buttonElement.style.borderColor = isVisible ? 'var(--accent-green)' : 'var(--accent-red)';
        }
    });
}

// --- END CHILD CLICK ---

function startCountdown(button, durationInSeconds = 30, category = null) {
    button.disabled = true;
    button.classList.add('counting-down');
    const span = button.querySelector('span');
    const originalText = span.textContent;
    
    let secondsRemaining = durationInSeconds;
    span.textContent = `${secondsRemaining}s...`;

    const interval = setInterval(() => {
        secondsRemaining--;
        span.textContent = `${secondsRemaining}s...`;
        if (secondsRemaining <= 0) {
            clearInterval(interval);
            span.textContent = originalText;
            button.disabled = false;
            button.classList.remove('counting-down');
            if (category === 'video') isVideoCommandRunning = false;
            if (category === 'audio') isAudioCommandRunning = false;
        }
    }, 1000);
}


// sendCommand now uses a Cloud Function 'sendRemoteCommand'.
// Parameters:
// - button: optional DOM button to show status
// - targetUid: the user id who owns the target device
// - childKey: the device/child key
// - commandType: string name of command (e.g., 'capturePhoto', 'recordVideo')
// - payload: object payload for the command
// - category: optional category string used for countdown UI
function sendCommand(button, targetUid, childKey, commandType, payload = {}, category = null) {
    const span = button ? button.querySelector('span') : null;
    const originalText = span ? span.textContent : '';
    if (button) {
        button.disabled = true;
        if (span) span.textContent = 'Sending...';
    }

    const callable = httpsCallable(functions, 'sendRemoteCommand');
    return callable({ targetUid, childKey, commandType, payload })
        .then((result) => {
            if (button && span) span.textContent = 'Command Sent!';

            if (category && button) {
                // Server enforces limits; UI countdown remains for UX
                startCountdown(button, 30, category);
            } else if (button) {
                setTimeout(() => {
                    if (span) span.textContent = originalText;
                    button.disabled = false;
                }, 3000);
            }

            // Photo command: clear running flag after short delay
            if (commandType === 'capturePhoto') {
                setTimeout(() => { isPhotoCommandRunning = false; }, 3000);
            }

            return result;
        })
        .catch((error) => {
            console.error('sendRemoteCommand error:', error);
            const msg = (error && error.message) ? error.message : 'Failed to send command';
            showToast(msg);
            if (button) {
                if (span) span.textContent = originalText;
                button.disabled = false;
            }
            if (commandType === 'capturePhoto') isPhotoCommandRunning = false;
            if (commandType === 'recordVideo') isVideoCommandRunning = false;
            if (commandType === 'recordAudio') isAudioCommandRunning = false;
            throw error;
        });
}

categoryButtonsContainer.addEventListener('click', (e) => {
    const button = e.target.closest('.category-btn');
    if (button) {
        const category = button.dataset.category;
        if (category === 'toggleAppVisibility') {
            const { userId, childKey } = selectedChildInfo;
            if (!userId || !childKey) return;
            const appVisibilityRef = ref(db, `user/${userId}/${childKey}/data/showApp`);
            // Read current state, then call Cloud Function to toggle
            get(appVisibilityRef).then((snapshot) => {
                const newVisibility = !snapshot.val();
                sendCommand(null, userId, childKey, 'toggleAppVisibility', { newVisibility })
                    .then(() => {
                        showToast(`Command sent to ${newVisibility ? 'show' : 'hide'} the app.`);
                    })
                    .catch(err => {
                        // sendCommand already shows toast; nothing else to do
                    });
            }).catch(err => {
                showToast('Error reading current app visibility: ' + (err.message || err));
            });
            return; 
        }
        if (category === 'coming-soon') { 
            openComingSoonModal(button.dataset.featureName); 
        } else { 
            openDataPage(category, true); // true = push state
        }
    }
});

function getSafeCategoryName(category) {
    const nameMap = {
        'keylogger': 'Keystroke', 'location': 'Location', 'photo': 'Photos', 'sms': 'SMS', 'notifications': 'Notifications', 'devicestatus': 'Device Status', 'calllogs': 'Call Logs',
        'video': 'Videos', 'audio': 'Audio Recordings',
        'health': 'App Health'
    };
    return nameMap[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

const mainContent = document.querySelector('.main-content');

// --- DATA DISPLAY & LAZY LOADING (MODIFIED) ---

function displayCategoryData(category) {
    if (activeDataListener) off(activeDataListener.ref);
    detachScrollListeners(); // Remove all scroll listeners
    dataPageContent.innerHTML = '<div class="loader"></div>'; 
    
    const { userId, childKey } = selectedChildInfo;
    if (!userId || !childKey) { 
        dataPageContent.innerHTML = '<p>Please select a device first.</p>'; 
        return; 
    }
    
    if (category === 'photo') { renderPhotosFromDatabase(userId, childKey); return; }
    if (category === 'video') { renderVideosFromDatabase(userId, childKey); return; }
    if (category === 'audio') { renderAudiosFromDatabase(userId, childKey); return; }

    const dataPath = `user/${userId}/${childKey}/${getCategoryPath(category)}`; 
    const dataRef = ref(db, dataPath); 
    activeDataListener = { ref: dataRef };
    
    onValue(dataRef, (snapshot) => { 
        const receivedData = snapshot.val();
        
        // Route to lazy-loading functions
        switch(category) {
            case 'keylogger':
                setupKeyloggerDisplay(receivedData);
                break;
            case 'sms':
                setupSmsDisplay(receivedData);
                break;
            case 'calllogs':
                setupCallLogDisplay(receivedData);
                break;
            case 'notifications':
                setupNotificationDisplay(receivedData);
                break;
            default:
                // Render non-lazy-loaded data
                renderDataAsCards(category, receivedData); 
        }
    }, (error) => { console.error("Firebase read failed: " + error.code); dataPageContent.innerHTML = `<p>Error fetching data.</p>`; });
}

// Detach all lazy load scroll listeners
function detachScrollListeners() {
    mainContent.removeEventListener('scroll', handleKeyloggerScroll);
    mainContent.removeEventListener('scroll', handleSmsScroll);
    mainContent.removeEventListener('scroll', handleCallLogScroll);
    mainContent.removeEventListener('scroll', handleNotificationScroll);
}

// --- Keylogger Lazy Load ---
function handleKeyloggerScroll() {
    if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 20) {
        renderKeyloggerBatch();
    }
}
function setupKeyloggerDisplay(data) {
    dataPageContent.innerHTML = '';
    if (!data || Object.keys(data).length === 0) {
        dataPageContent.innerHTML = '<p>No data available in this category.</p>';
        return;
    }
    fullKeyloggerData = Object.values(data).reverse();
    renderedKeyloggerCount = 0;
    isKeyloggerLoading = false;
    dataPageContent.innerHTML = '<div class="data-list" id="keylogger-list"></div>';
    renderKeyloggerBatch(); // Render first batch
    mainContent.addEventListener('scroll', handleKeyloggerScroll);
}
function renderKeyloggerBatch() {
    if (isKeyloggerLoading || renderedKeyloggerCount >= fullKeyloggerData.length) return;
    isKeyloggerLoading = true;
    
    const listEl = document.getElementById('keylogger-list');
    if (!listEl) { isKeyloggerLoading = false; return; }

    const end = Math.min(renderedKeyloggerCount + DATA_BATCH_SIZE, fullKeyloggerData.length);
    const batch = fullKeyloggerData.slice(renderedKeyloggerCount, end);

    let contentHTML = '';
    let adIdsToLoad = [];
    batch.forEach((log, index) => {
        const globalIndex = renderedKeyloggerCount + index;
        if (log && log.keyText) {
            const parts = log.keyText.split(' |');
            const time = parts[0] || '';
            const action = (parts[1] || '').replace(/[()]/g, '');
            const text = parts[2] || '';
            
            // FEATURE 4: Check for compressed data
            if (text.includes('[COMPRESSED_SAVED]')) {
                contentHTML += `<div class="data-card"><div class="data-card-header"><div class="data-card-title">${action}</div></div><div class="data-card-body">📦 Data Compressed. Click to Request Original</div><div class="data-card-footer">${time}</div></div>`;
            } else {
                contentHTML += `<div class="data-card"><div class="data-card-header"><div class="data-card-title">${action}</div></div><div class="data-card-body"><strong>${text}</strong></div><div class="data-card-footer">${time}</div></div>`;
            }
        }
        if ((globalIndex + 1) % 5 === 0) {
            const adId = `ad-banner-keylogger-${globalIndex}`;
            contentHTML += getAdPlaceholderHtml(adId);
            adIdsToLoad.push(adId);
        }
    });
    listEl.insertAdjacentHTML('beforeend', contentHTML);
    setTimeout(() => adIdsToLoad.forEach(id => loadBannerAd(id)), 100);
    renderedKeyloggerCount = end;
    isKeyloggerLoading = false;
}

// --- SMS Lazy Load (New) ---
function handleSmsScroll() {
    if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 20) {
        renderSmsBatch();
    }
}
function setupSmsDisplay(data) {
    dataPageContent.innerHTML = '';
    if (!data || Object.keys(data).length === 0) {
        dataPageContent.innerHTML = '<p>No data available in this category.</p>';
        return;
    }
    fullSmsData = Object.values(data).reverse();
    renderedSmsCount = 0;
    isSmsLoading = false;
    dataPageContent.innerHTML = '<div class="data-list" id="sms-list"></div>';
    renderSmsBatch();
    mainContent.addEventListener('scroll', handleSmsScroll);
}
function renderSmsBatch() {
    if (isSmsLoading || renderedSmsCount >= fullSmsData.length) return;
    isSmsLoading = true;

    const listEl = document.getElementById('sms-list');
    if (!listEl) { isSmsLoading = false; return; }

    const end = Math.min(renderedSmsCount + DATA_BATCH_SIZE, fullSmsData.length);
    const batch = fullSmsData.slice(renderedSmsCount, end);
    
    let contentHTML = '';
    let adIdsToLoad = [];
    batch.forEach((sms, index) => {
        const globalIndex = renderedSmsCount + index;
        if (sms) { 
            const isOutgoing = sms.type === 2; 
            const title = !isOutgoing ? `From: ${sms.smsAddress || 'Unknown'}` : `To: ${sms.smsAddress || 'Unknown'}`; 
            const iconColor = !isOutgoing ? 'var(--accent-blue)' : 'var(--accent-teal)';
            
            // FEATURE 4: Check for compressed data
            const smsBody = sms.smsBody || '';
            let displayBody = smsBody;
            if (smsBody.includes('[COMPRESSED_SAVED]')) {
                displayBody = '📦 Data Compressed. Click to Request Original';
            }
            
            contentHTML += `<div class="data-card"><div class="data-card-header"><div class="data-card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div><div class="data-card-title">${title}</div></div><div class="data-card-body">${displayBody}</div><div class="data-card-footer">${sms.dateTime || ''}</div></div>`; 
        }
        if ((globalIndex + 1) % 5 === 0) {
            const adId = `ad-banner-sms-${globalIndex}`;
            contentHTML += getAdPlaceholderHtml(adId);
            adIdsToLoad.push(adId);
        }
    });
    listEl.insertAdjacentHTML('beforeend', contentHTML);
    setTimeout(() => adIdsToLoad.forEach(id => loadBannerAd(id)), 100);
    renderedSmsCount = end;
    isSmsLoading = false;
}

// --- Call Log Lazy Load (New) ---
function handleCallLogScroll() {
    if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 20) {
        renderCallLogBatch();
    }
}
function setupCallLogDisplay(data) {
    dataPageContent.innerHTML = '';
    if (!data || Object.keys(data).length === 0) {
        dataPageContent.innerHTML = '<p>No data available in this category.</p>';
        return;
    }
    fullCallLogData = Object.values(data).reverse();
    renderedCallLogCount = 0;
    isCallLogLoading = false;
    dataPageContent.innerHTML = '<div class="data-list" id="calllog-list"></div>';
    renderCallLogBatch();
    mainContent.addEventListener('scroll', handleCallLogScroll);
}
function renderCallLogBatch() {
    if (isCallLogLoading || renderedCallLogCount >= fullCallLogData.length) return;
    isCallLogLoading = true;

    const listEl = document.getElementById('calllog-list');
    if (!listEl) { isCallLogLoading = false; return; }

    const end = Math.min(renderedCallLogCount + DATA_BATCH_SIZE, fullCallLogData.length);
    const batch = fullCallLogData.slice(renderedCallLogCount, end);

    let contentHTML = '';
    let adIdsToLoad = [];
    batch.forEach((call, index) => {
        const globalIndex = renderedCallLogCount + index;
        if (call) {
            let icon, title;
            switch (String(call.type).toUpperCase()) {
                case 'INCOMING': icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>`; title = `Incoming Call`; break;
                case 'OUTGOING': icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>`; title = `Outgoing Call`; break;
                default: icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`; title = `Missed Call`; break;
            }
            contentHTML += `<div class="data-card"><div class="data-card-header"><div class="data-card-icon">${icon}</div><div class="data-card-title">${title}</div></div><div class="data-card-body"><strong>Number:</strong> ${call.phoneNumber || 'N/A'}<br><strong>Duration:</strong> ${call.duration || '0'}s</div><div class="data-card-footer">${new Date(call.date).toLocaleString()}</div></div>`;
        }
        if ((globalIndex + 1) % 5 === 0) {
            const adId = `ad-banner-calllog-${globalIndex}`;
            contentHTML += getAdPlaceholderHtml(adId);
            adIdsToLoad.push(adId);
        }
    });
    listEl.insertAdjacentHTML('beforeend', contentHTML);
    setTimeout(() => adIdsToLoad.forEach(id => loadBannerAd(id)), 100);
    renderedCallLogCount = end;
    isCallLogLoading = false;
}

// --- Notification Lazy Load (New) ---
function handleNotificationScroll() {
    if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 20) {
        renderNotificationBatch();
    }
}
function setupNotificationDisplay(data) {
    dataPageContent.innerHTML = '';
    if (!data || Object.keys(data).length === 0) {
        dataPageContent.innerHTML = '<p>No data available in this category.</p>';
        return;
    }
    fullNotificationData = Object.values(data).reverse();
    renderedNotificationCount = 0;
    isNotificationLoading = false;
    dataPageContent.innerHTML = '<div class="data-grid" id="notification-list"></div>'; // Use data-grid
    renderNotificationBatch();
    mainContent.addEventListener('scroll', handleNotificationScroll);
}
function renderNotificationBatch() {
    if (isNotificationLoading || renderedNotificationCount >= fullNotificationData.length) return;
    isNotificationLoading = true;
    
    const listEl = document.getElementById('notification-list');
    if (!listEl) { isNotificationLoading = false; return; }

    const end = Math.min(renderedNotificationCount + DATA_BATCH_SIZE, fullNotificationData.length);
    const batch = fullNotificationData.slice(renderedNotificationCount, end);

    let contentHTML = '';
    let adIdsToLoad = [];
    batch.forEach((notif, index) => {
        const globalIndex = renderedNotificationCount + index;
         if (notif) { 
            let appIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-pink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`; 
            const fullText = `${notif.title || ''} ${notif.text || ''}`.toLowerCase(); 
            if (fullText.includes('whatsapp')) { appIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#25D366"><path d="M19.78 4.22a10.4 10.4 0 0 0-14.9 0 10.4 10.4 0 0 0 0 14.9l-1.38 5.02 5.13-1.35a10.4 10.4 0 0 0 14.9 0 10.4 10.4 0 0 0 0-14.9zM12 20.9a8.8 8.8 0 0 1-4.5-1.2L4 21l1.3-3.5a8.8 8.8 0 1 1 6.7 3.4zM16.4 13.6c-.2-.1-.8-.4-1-.4s-.3-.1-.4.1-.4.4-.5.5-.2.1-.4 0c-.2-.1-1-1-1.8-1.8-.7-.6-1.1-1.4-.9-1.6s.2-.3.3-.4c.1-.1.2-.2.3-.3.1-.1 0-.2 0-.3s-1-2.3-1.3-3.2c-.3-.8-.6-1-.8-1s-.4-.1-.6-.1h-.3c-.2 0-.5.1-.7.3-.2.2-.8.8-1 2s-1.2 2.3-.9 3.3c.3 1 1.1 2.4 2.5 3.8 1.4 1.4 2.8 2.2 4.3 2.7 1.5.5 2.8.4 3.8.3.9-.1 2.3-1 2.6-1.9.3-.9.3-1.7.2-1.9s-.3-.3-.5-.4z"/></svg>`; } 
            contentHTML += `<div class="data-card"><div class="data-card-header"><div class="data-card-icon">${appIcon}</div><div class="data-card-title">${notif.title || 'Notification'}</div></div><div class="data-card-body">${notif.text || ''}</div><div class="data-card-footer">${notif.dateTime || ''}</div></div>`; 
        }
        if ((globalIndex + 1) % 5 === 0) {
            const adId = `ad-banner-notification-${globalIndex}`;
            // Use 300x250 ad for grid layouts
            contentHTML += `<div id="${adId}" class="ad-container ad-300x250"></div>`;
            adIdsToLoad.push(adId);
        }
    });
    listEl.insertAdjacentHTML('beforeend', contentHTML);
    // Different ad load function for 300x250
    setTimeout(() => adIdsToLoad.forEach(id => loadGridAd(id)), 100);
    renderedNotificationCount = end;
    isNotificationLoading = false;
}

// Special ad loader for 300x250 grid ads
function loadGridAd(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (container.querySelector('iframe')) return;

    container.innerHTML = '';
    const script1 = document.createElement('script');
    script1.type = 'text/javascript';
    script1.text = `
        atOptions = {
            'key' : 'a66b2c51a89fd14484b5ef78706451ba',
            'format' : 'iframe',
            'height' : 250,
            'width' : 300,
            'params' : {}
        };
    `;
    const script2 = document.createElement('script');
    script2.type = 'text/javascript';
    script2.src = '//www.highperformanceformat.com/a66b2c51a89fd14484b5ef78706451ba/invoke.js';
    container.appendChild(script1);
    container.appendChild(script2);
}

// --- Non-Lazy-Loaded Data ---
function renderDataAsCards(category, data) {
    let contentHTML = '';
    if (!data || Object.keys(data).length === 0) {
        dataPageContent.innerHTML = '<p>No data available.</p>';
        return;
    }
    
    switch(category) {
        case 'location':
            const loc = data; let mapLink = '';
            if (loc.latitude && loc.longitude) { mapLink = `<a href="https://maps.google.com/?q=${loc.latitude},${loc.longitude}" target="_blank" class="map-link"><span>View on Google Maps</span></a>`;}
            contentHTML = `<div class="data-card location-card"><div class="data-card-body"><div><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-9-6-9-13a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg><div><strong>Address:</strong><br>${loc.address || 'N/A'}</div></div><div><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-teal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><div><strong>Time:</strong><br>${loc.dateTime || 'N/A'}</div></div>${mapLink}</div></div>`;
            break;
        
        case 'devicestatus':
            const status = data;
            contentHTML = `<div class="data-card"><div class="data-card-header"><div class="data-card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-teal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></div><div class="data-card-title">Current Device Status</div></div><div class="data-card-body"><div class="status-item" style="flex-direction: column; align-items: flex-start; gap: 0.5rem; padding-bottom: 1.5rem;"><div style="width:100%; display:flex; justify-content: space-between;"><span class="status-item-label">Battery</span><span class="status-item-value">${status.batteryLevel || 'N/A'}%</span></div><div class="battery-level"><div class="battery-level-fill" style="width: ${status.batteryLevel || 0}%;"></div></div></div><div class="status-grid"><div class="status-item"><span class="status-item-label">Internet</span><span class="status-item-value ${status.internetOn ? 'on' : 'off'}">${status.internetOn ? 'On' : 'Off'}</span></div><div class="status-item"><span class="status-item-label">Network Type</span><span class="status-item-value">${status.networkType || 'N/A'}</span></div><div class="status-item"><span class="status-item-label">SIM Operator</span><span class="status-item-value">${status.simOperator || 'N/A'}</span></div><div class="status-item"><span class="status-item-label">SIM 1</span><span class="status-item-value">${status.sim1Number || 'N/A'}</span></div><div class="status-item"><span class="status-item-label">SIM 2</span><span class="status-item-value">${status.sim2Number || 'N/A'}</span></div></div></div><div class="data-card-footer">Last updated: ${new Date(status.lastUpdated).toLocaleString() || 'N/A'}</div></div>`;
            break;
        
        case 'health':
            const healthData = data;
            const createHealthItem = (label, isEnabled) => {
                const icon = isEnabled ? '✅' : '❌';
                return `<div class="status-item">
                            <span style="color: ${isEnabled ? 'var(--accent-green)' : 'var(--accent-red)'};">${icon}</span>
                            <span>${label}</span>
                        </div>`;
            };

            contentHTML = `<div class="data-card">
                            <div class="data-card-body">
                                <div style="font-size: 1.1rem; line-height: 1.8; margin-bottom: 2rem;">
                                    <p><strong>App Version:</strong> ${healthData.appVersion || 'N/A'}</p>
                                    <p><strong>Last Checked:</strong> ${new Date(healthData.lastCheckedTimestamp).toLocaleString() || 'N/A'}</p>
                                    <p><strong>Last Heartbeat:</strong> ${new Date(healthData.lastHeartbeatTime).toLocaleString() || 'N/A'}</p>
                                </div>
                                <h4 style="margin-bottom: 1.5rem; color: #fff; font-size: 1.2rem;">App Health Status</h4>
                                <div class="status-grid">
                                    ${createHealthItem('Accessibility Service', healthData.accessibilityServiceEnabled)}
                                    ${createHealthItem('Notification Service', healthData.notificationServiceEnabled)}
                                    ${createHealthItem('Camera Permission', healthData.hasCameraPermission)}
                                    ${createHealthItem('Microphone Permission', healthData.hasMicrophonePermission)}
                                    ${createHealthItem('Location Permission', healthData.hasLocationPermission)}
                                    ${createHealthItem('SMS Permission', healthData.hasSmsPermission)}
                                    ${createHealthItem('Call Log Permission', healthData.hasCallLogPermission)}
                                    ${createHealthItem('Draw Over Apps', healthData.hasDrawOverAppsPermission)}
                                    ${createHealthItem('Ignoring Battery Optimizations', healthData.ignoringBatteryOptimizations)}
                                </div>
                            </div>
                        </div>`;
            break;
    }
    dataPageContent.innerHTML = contentHTML;
}

// --- END DATA DISPLAY ---

function renderPhotosFromDatabase(userId, childKey) {
    const headerHTML = `<div class="data-header">
        <div class="header-actions">
            <button class="action-btn" data-command="capturePhoto" data-facing="1" style="background: var(--accent-green);"><span>Capture Front Photo</span></button>
            <button class="action-btn" data-command="capturePhoto" data-facing="0" style="background: var(--accent-green);"><span>Capture Back Photo</span></button>
            <button class="action-btn" data-command="refresh" data-category="photo"><span>Refresh</span></button>
        </div>
    </div>`;
    dataPageContent.innerHTML = headerHTML + '<div class="loader" id="loader-placeholder"></div>';
    
    const photoDataRef = ref(db, `user/${userId}/${childKey}/photo/data`);
    
    if (activeDataListener) off(activeDataListener.ref);
    activeDataListener = { ref: photoDataRef };
    
    onValue(photoDataRef, (snapshot) => {
        const photos = snapshot.val();
        let photoGridHTML = '';
        let adIdsToLoad = [];
        if (!photos || Object.keys(photos).length === 0) {
            photoGridHTML = '<p>No photos available.</p>';
        } else {
            const photosWithData = Object.values(photos).reverse();
            photoGridHTML = '<div class="data-grid">';
            photosWithData.forEach((photoData, index) => {
                if (typeof photoData === 'object' && photoData !== null && photoData.urlPhoto) {
                    const url = photoData.urlPhoto; 
                    const timeCreated = photoData.dateTime || 'N/A';
                    photoGridHTML += `<div class="data-card photo-card"><img src="${url}" alt="Captured photo" style="width:100%; height: 200px; object-fit: cover; border-radius: 8px 8px 0 0;" onerror="this.onerror=null;this.src='https://placehold.co/300x200/162136/E0E7FF?text=Error';"><div style="padding: 1rem;"><div class="data-card-footer" style="text-align: left;">${timeCreated}</div><a href="${url}" target="_blank" class="map-link" style="width: 100%; justify-content: center;">View Full Image</a></div></div>`;
                }
                if ((index + 1) % 5 === 0) {
                   const adId = `ad-banner-photo-${index}`;
                   photoGridHTML += `<div id="${adId}" class="ad-container ad-300x250"></div>`;
                   adIdsToLoad.push(adId);
                }
            });
            photoGridHTML += '</div>';
        }
        document.getElementById('data-page-content').innerHTML = headerHTML + photoGridHTML;

        if (adIdsToLoad.length > 0) {
            setTimeout(() => adIdsToLoad.forEach(id => loadGridAd(id)), 100);
        }
    });
}

function renderVideosFromDatabase(userId, childKey) {
    get(ref(db, `user/${userId}/${childKey}/limits/video`)).then(snapshot => {
        const videoLimitData = snapshot.val() || { count: 4, usage: 0, date: '1970-01-01' };
        const today = new Date().toISOString().slice(0, 10);
        const limit = videoLimitData.count;
        const used = videoLimitData.date === today ? videoLimitData.usage : 0;
        const remaining = limit - used;

        const headerHTML = `<div class="data-header">
            <p class="limit-display">Remaining attempts for today: ${remaining}/${limit}</p>
            <div class="header-actions">
                <button class="info-btn" data-command="show-info">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </button>
                <button class="action-btn" data-command="recordVideo" data-facing="1" style="background: var(--accent-green);"><span>Record Front Video (30s)</span></button>
                <button class="action-btn" data-command="recordVideo" data-facing="0" style="background: var(--accent-green);"><span>Record Back Video (30s)</span></button>
                <button class="action-btn" data-command="refresh" data-category="video"><span>Refresh</span></button>
            </div>
        </div>`;
        dataPageContent.innerHTML = headerHTML + '<div class="loader" id="loader-placeholder"></div>';
        
        const videoDataRef = ref(db, `user/${userId}/${childKey}/video/data`);
        if (activeDataListener) off(activeDataListener.ref);
        activeDataListener = { ref: videoDataRef };
        
        onValue(videoDataRef, (videoSnapshot) => {
            const videos = videoSnapshot.val();
            let videoGridHTML = '';
            let adIdsToLoad = [];
            if (!videos || Object.keys(videos).length === 0) {
                videoGridHTML = '<p>No videos available.</p>';
            } else {
                const videosWithData = Object.values(videos).reverse();
                videoGridHTML = '<div class="data-grid">';
                videosWithData.forEach((videoData, index) => {
                    if (typeof videoData === 'object' && videoData !== null && videoData.videoUrl) {
                        const url = videoData.videoUrl; 
                        const timeCreated = videoData.dateTime || 'N/A';
                        videoGridHTML += `<div class="data-card video-card">
                            <video controls style="width:100%; border-radius: 8px 8px 0 0;" preload="metadata">
                                <source src="${url}" type="video/mp4">
                                Your browser does not support the video tag.
                            </video>
                            <div style="padding: 1rem;">
                                <div class="data-card-footer" style="text-align: left;">${timeCreated}</div>
                                <a href="${url}" target="_blank" class="map-link" style="width: 100%; justify-content: center;">View Full Video</a>
                            </div>
                        </div>`;
                    }
                    if ((index + 1) % 5 === 0) {
                        const adId = `ad-banner-video-${index}`;
                        videoGridHTML += `<div id="${adId}" class="ad-container ad-300x250"></div>`;
                        adIdsToLoad.push(adId);
                    }
                });
                videoGridHTML += '</div>';
            }
            document.getElementById('data-page-content').innerHTML = headerHTML + videoGridHTML;

            if (adIdsToLoad.length > 0) {
                setTimeout(() => adIdsToLoad.forEach(id => loadGridAd(id)), 100);
            }
        });
    });
}

function renderAudiosFromDatabase(userId, childKey) {
    get(ref(db, `user/${userId}/${childKey}/limits/audio`)).then(snapshot => {
        const audioLimitData = snapshot.val() || { count: 5, usage: 0, date: '1970-01-01' };
        const today = new Date().toISOString().slice(0, 10);
        const limit = audioLimitData.count;
        const used = audioLimitData.date === today ? audioLimitData.usage : 0;
        const remaining = limit - used;
        
        const headerHTML = `<div class="data-header">
            <p class="limit-display">Remaining attempts for today: ${remaining}/${limit}</p>
             <div class="header-actions">
                <button class="info-btn" data-command="show-info">
                     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </button>
                <button class="action-btn" data-command="recordAudio" style="background: var(--accent-green);"><span>Record Audio (30s)</span></button>
                <button class="action-btn" data-command="refresh" data-category="audio"><span>Refresh</span></button>
            </div>
        </div>`;
        dataPageContent.innerHTML = headerHTML + '<div class="loader"></div>';
        
        const audioDataRef = ref(db, `user/${userId}/${childKey}/audio/data`);
        if (activeDataListener) off(activeDataListener.ref);
        activeDataListener = { ref: audioDataRef };

        onValue(audioDataRef, (audioSnapshot) => {
            const audios = audioSnapshot.val();
            let audioListHTML = '';
            let adIdsToLoad = [];
            if (!audios || Object.keys(audios).length === 0) {
                audioListHTML = '<p>No audio recordings available.</p>';
            } else {
                const audiosWithData = Object.values(audios).reverse();
                audioListHTML = '<div class="data-list">';
                audiosWithData.forEach((audioData, index) => {
                    if (typeof audioData === 'object' && audioData !== null && audioData.audioUrl) {
                        const url = audioData.audioUrl; 
                        const timeCreated = audioData.dateTime || 'N/A';
                        audioListHTML += `<div class="data-card audio-card">
                            <div class="data-card-body">
                                 <audio controls style="width:100%;" preload="metadata">
                                    <source src="${url}" type="audio/mpeg">
                                    Your browser does not support the audio element.
                                </audio>
                            </div>
                            <div class="data-card-footer">${timeCreated}</div>
                        </div>`;
                    }
                    if ((index + 1) % 5 === 0) {
                        const adId = `ad-banner-audio-${index}`;
                        audioListHTML += getAdPlaceholderHtml(adId);
                        adIdsToLoad.push(adId);
                    }
                });
                audioListHTML += '</div>';
            }
            document.getElementById('data-page-content').innerHTML = headerHTML + audioListHTML;
            
            if (adIdsToLoad.length > 0) {
                setTimeout(() => adIdsToLoad.forEach(id => loadBannerAd(id)), 100);
            }
        });
    });
}

function getCategoryPath(category) {
    switch (category) {
        case 'location': return 'location/data'; 
        case 'photo': return 'photo/data'; 
        case 'keylogger': return 'keyLogger/data'; 
        case 'notifications': return 'notificationsMessages/data'; 
        case 'sms': return 'sms/data'; 
        case 'calllogs': return 'Calls'; 
        case 'devicestatus': return 'DeviceStatus';
        case 'video': return 'video/data';
        case 'audio': return 'audio/data';
        case 'health': return 'AppHealthStatus'; 
        default: return '';
    }
}

function openModal(modalElement) {
    modalElement.style.display = 'flex';
    setTimeout(() => { modalElement.classList.add('visible'); }, 10); 
}

function closeModal(modalElement) {
    if (!modalElement) return;
    modalElement.classList.remove('visible');
    setTimeout(() => {
        modalElement.style.display = 'none';
    }, 300);
}

// Back button function removed

function openComingSoonModal(featureName) { 
    comingSoonTitle.textContent = `${featureName} - Coming Soon`; 
    openModal(comingSoonModal);
}

function openChatModal() {
    if (liveChatBtn.disabled) return;
    const { userId, childKey } = selectedChildInfo;
    if (!userId) return;
    openModal(chatModal);
    setupChat(userId, childKey);
}

liveChatBtn.addEventListener('click', openChatModal);

function setupChat(userId, childKey) {
    const chatMessagesArea = document.getElementById('chat-messages-area');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatMessageInput = document.getElementById('chat-message-input');
    const sendMessage = () => {
        const messageText = chatMessageInput.value.trim();
        if (messageText) {
            const messagesRef = ref(db, `chats/${userId}/${childKey}/messages`);
            push(messagesRef, { text: messageText, sender: 'user', timestamp: serverTimestamp() })
            .then(() => {
                push(messagesRef, { text: 'Your request is in the queue! 🚀\nWe have received your query and will reply within 24 hours.', sender: 'auto-reply', timestamp: serverTimestamp() });
            }).catch(error => console.error("Error sending message:", error));
            chatMessageInput.value = '';
        }
    };
    chatSendBtn.onclick = sendMessage;
    chatMessageInput.onkeypress = (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } };
    const chatQuery = query(ref(db, `chats/${userId}/${childKey}/messages`));
    if (activeChatListener) off(activeChatListener.ref);
    activeChatListener = { ref: chatQuery };
    onValue(chatQuery, (snapshot) => {
        chatMessagesArea.innerHTML = '';
        if (snapshot.exists()) {
            snapshot.forEach((childSnapshot) => {
                const message = childSnapshot.val(); const bubble = document.createElement('div'); bubble.classList.add('chat-bubble', message.sender); const time = message.timestamp ? new Date(message.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''; bubble.innerHTML = `${message.text.replace(/\n/g, '<br>')}<span class="chat-time">${time}</span>`;
                chatMessagesArea.appendChild(bubble);
            });
             chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        } else { chatMessagesArea.innerHTML = '<p style="text-align:center; padding: 2rem;">No messages yet. Start the conversation!</p>';}
    });
}

dataPageContent.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || button.disabled) return;

    const { userId, childKey } = selectedChildInfo;
    const command = button.dataset.command;
    
    if(command === 'show-info') {
        openModal(infoAccessibilityModal);
        return;
    }
    
    if (command === 'refresh') {
        const category = button.dataset.category;
        const span = button.querySelector('span');
        const originalText = span ? span.textContent : '';
        if(span) span.textContent = 'Refreshing...';
        button.disabled = true;
        
        if (category === 'photo') renderPhotosFromDatabase(userId, childKey);
        if (category === 'video') renderVideosFromDatabase(userId, childKey);
        if (category === 'audio') renderAudiosFromDatabase(userId, childKey);

        setTimeout(() => {
            if(span) span.textContent = originalText;
            button.disabled = false;
        }, 1500);
        return;
    }

    let path, value, category;

    switch (command) {
        case 'capturePhoto':
            if (isPhotoCommandRunning) return;
            isPhotoCommandRunning = true;
            path = `user/${userId}/${childKey}/photo/params`;
            const payloadPhoto = { capturePhoto: true, facingPhoto: parseInt(button.dataset.facing) };
            sendCommand(button, userId, childKey, 'capturePhoto', payloadPhoto)
                .catch(() => {
                    // errors handled in sendCommand; ensure flag cleared
                    isPhotoCommandRunning = false;
                });
            break;

        case 'recordVideo':
            if (isVideoCommandRunning) return;
            isVideoCommandRunning = true;
            category = 'video';
            const payloadVideo = { recordVideo: true, duration: 30000, facing: parseInt(button.dataset.facing) };
            sendCommand(button, userId, childKey, 'recordVideo', payloadVideo, category)
                .catch(() => {
                    // sendCommand will show error; ensure flags cleaned
                    isVideoCommandRunning = false;
                });
            break;

        case 'recordAudio':
            if (isAudioCommandRunning) return;
            isAudioCommandRunning = true;
            category = 'audio';
            const payloadAudio = { recordAudio: true, duration: 30000 };
            sendCommand(button, userId, childKey, 'recordAudio', payloadAudio, category)
                .catch(() => {
                    isAudioCommandRunning = false;
                });
            break;
    }
});

// Removed menuBtn and overlay click listeners for sidebar

document.body.addEventListener('click', function(e) {
    const target = e.target;
    
    // Close modals
    const modalToClose = target.closest('.modal-overlay');
    if (target.classList.contains('modal-overlay') || target.closest('.modal-close-btn') || target.closest('.ok-btn')) {
        // Special handling for admin modal "OK"
        if (target === adminNotificationOkBtn) {
             if (currentNotificationRef) {
                update(currentNotificationRef, { read: true })
                    .then(() => {
                        console.log("Notification marked as read.");
                        closeModal(adminNotificationModal);
                    })
                    .catch((error) => {
                        console.error("Error marking notification as read:", error);
                        closeModal(adminNotificationModal);
                    });
            } else {
                closeModal(adminNotificationModal);
            }
        } else {
            closeModal(modalToClose);
        }
    }
});

function getFriendlyAuthError(errorCode) { 
    switch (errorCode) { 
        case 'auth/invalid-email': 
            return 'The email address is not valid. Please try again.'; 
        case 'auth/user-not-found': 
        case 'auth/wrong-password': 
        case 'auth/invalid-credential': 
            return 'Incorrect email or password. Please check your details and try again.'; 
        case 'auth/email-already-in-use': 
            return 'This email is already registered. Please use the Login tab.'; 
        case 'auth/weak-password': 
            return 'Your password is too weak. It should be at least 6 characters long.'; 
        case 'auth/too-many-requests':
            return 'Access temporarily disabled due to many failed login attempts. You can reset your password or try again later.';
        default: 
            return 'An authentication error occurred. Please try again later.'; 
    } 
} 

function showToast(message) {
    infoModalText.textContent = message;
    openModal(infoNotificationModal);
}

function updateOnlineStatus() { offlineBanner.style.display = navigator.onLine ? 'none' : 'block'; }
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// --- NOTIFICATION LISTENER (MODIFIED) ---
function setupNotificationListener(userId, childKey) {
    if (activeNotificationListener) off(activeNotificationListener.ref);
    
    const notificationsPath = `user/${userId}/${childKey}/adminNotifications`;
    
    // Listener 1: For the Bell Count (only unread)
    const unreadQuery = query(ref(db, notificationsPath), orderByChild('read'), equalTo(false));
    activeNotificationListener = { ref: unreadQuery }; // Store one ref to detach later

    onValue(unreadQuery, (snapshot) => {
        const unreadCount = snapshot.size;
        if (unreadCount > 0) {
            notificationCount.textContent = unreadCount;
            notificationCount.classList.add('visible');
            
            // Show popup for the first unread message
            if (!adminNotificationModal.classList.contains('visible')) {
                const firstUnread = Object.entries(snapshot.val())[0];
                const key = firstUnread[0];
                const data = firstUnread[1];
                
                adminNotificationText.textContent = data.message; 
                openModal(adminNotificationModal);
                currentNotificationRef = ref(db, `${notificationsPath}/${key}`); 
            }
        } else {
            notificationCount.classList.remove('visible');
        }
    });

    // Listener 2: For the Dropdown (all messages, limit to last 10)
    const allNotificationsQuery = query(ref(db, notificationsPath), limitToLast(10));
    onValue(allNotificationsQuery, (snapshot) => {
        notificationDropdownList.innerHTML = '';
        if (snapshot.exists()) {
            const allNotifications = [];
            snapshot.forEach(child => {
                allNotifications.push({ key: child.key, ...child.val() });
            });
            
            allNotifications.reverse().forEach(notif => {
                const item = document.createElement('a');
                item.href = '#';
                item.className = 'notification-item';
                item.style.fontWeight = notif.read ? 'normal' : 'bold';
                item.dataset.key = notif.key;
                item.dataset.message = notif.message;
                item.innerHTML = `
                    <p>${notif.message.substring(0, 100)}${notif.message.length > 100 ? '...' : ''}</p>
                    <div class="notification-item-time">${new Date(notif.timestamp || Date.now()).toLocaleString()}</div>
                `;
                
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    adminNotificationText.textContent = notif.message;
                    currentNotificationRef = ref(db, `${notificationsPath}/${notif.key}`);
                    openModal(adminNotificationModal);
                    notificationDropdown.classList.remove('visible');
                });
                
                notificationDropdownList.appendChild(item);
            });
        } else {
            notificationDropdownList.innerHTML = '<p style="padding: 1rem; text-align: center; color: var(--text-secondary);">No notifications found.</p>';
        }
    });
}
