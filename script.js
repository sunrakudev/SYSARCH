// ============================================
// CCS Sit-in Monitoring System - Main Script
// ============================================

// Storage Keys
const STORAGE_KEYS = {
    USERS: 'ccs_registered_users',
    CURRENT_USER: 'ccs_current_user',
    REMEMBER_ME: 'ccs_remember_me',
    THEME: 'ccs_theme_preference',
    ADMINS: 'ccs_admin_users',
    ADMIN_CURRENT: 'ccs_admin_current',
    ANNOUNCEMENTS: 'ccs_announcements',
    SITIN_RECORDS: 'ccs_sitin_records',
    SITIN_CURRENT: 'ccs_sitin_current',
    LAB_ROOMS: 'ccs_lab_rooms',
    RESERVATION_ENABLED: 'ccs_reservation_enabled'
};

const SUPABASE_CONFIG = {
    URL: 'https://qjrfkgtwzvqkaxduaore.supabase.co',
    KEY: 'sb_publishable_nSYIVlTF9pvqApBZ06bZwg_dzXdMSss'
};

let supabaseClient = null;

function getSupabaseClient() {
    if (!window.supabase || !SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.KEY) {
        return null;
    }

    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.KEY);
    }

    return supabaseClient;
}

function getStudentAuthEmail(idNumber) {
    return `${String(idNumber).trim().toLowerCase()}@ccs-sitin.local`;
}

function dbStudentToUser(student) {
    if (!student) return null;

    return {
        idNumber: student.id_number,
        firstName: student.first_name,
        lastName: student.last_name,
        middleName: student.middle_name || '',
        email: student.email || '',
        course: student.course || '',
        courseLevel: student.course_level || '',
        address: student.address || '',
        remainingSessions: student.remaining_sessions ?? 30,
        registeredAt: student.registered_at || new Date().toISOString()
    };
}

function saveOrUpdateLocalUser(userData) {
    const users = getUsers();
    const existingIndex = users.findIndex(u => u.idNumber === userData.idNumber);

    if (existingIndex === -1) {
        users.push(userData);
    } else {
        users[existingIndex] = { ...users[existingIndex], ...userData };
    }

    saveUsers(users);
}

async function restoreSupabaseUserSession() {
    if (getCurrentUser()) return;

    const client = getSupabaseClient();
    if (!client) return;

    const { data: userData } = await client.auth.getUser();
    const authUser = userData?.user;
    if (!authUser) return;

    const { data: student } = await client
        .from('students')
        .select('*')
        .eq('user_id', authUser.id)
        .single();

    const user = dbStudentToUser(student);
    if (!user) return;

    saveOrUpdateLocalUser(user);
    setCurrentUser({
        idNumber: user.idNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        course: user.course,
        courseLevel: user.courseLevel
    });
}

// ============================================
// Default Admin Account
// ============================================

function initDefaultAdmin() {
    const admins = getAdmins();
    if (admins.length === 0) {
        admins.push({
            username: 'admin',
            password: 'admin123',
            name: 'System Administrator',
            createdAt: new Date().toISOString()
        });
        saveAdmins(admins);
    }
}

// ============================================
// Database Helper Functions (LocalStorage)
// ============================================

function getUsers() {
    const users = localStorage.getItem(STORAGE_KEYS.USERS);
    return safeParseJSON(users, []);
}

function saveUsers(users) {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
}

function getCurrentUser() {
    const user = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    return safeParseJSON(user, null);
}

function setCurrentUser(user) {
    if (user) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    }
}

async function registerUser(userData) {
    const users = getUsers();
    
    // Check if ID number already exists
    const existingUser = users.find(u => u.idNumber === userData.idNumber);
    if (existingUser) {
        return { success: false, message: 'ID Number is already registered. Please use a different ID or login.' };
    }

    const client = getSupabaseClient();
    if (client) {
        const authEmail = getStudentAuthEmail(userData.idNumber);
        const { data: authData, error: authError } = await client.auth.signUp({
            email: authEmail,
            password: userData.password
        });

        if (authError) {
            return { success: false, message: authError.message };
        }

        if (!authData.user) {
            return { success: false, message: 'Registration failed. Please check Supabase email confirmation settings.' };
        }

        const { error: profileError } = await client.from('students').insert({
            user_id: authData.user.id,
            id_number: userData.idNumber,
            first_name: userData.firstName,
            last_name: userData.lastName,
            middle_name: userData.middleName || null,
            email: userData.email,
            course: userData.course,
            course_level: userData.courseLevel,
            address: userData.address,
            remaining_sessions: userData.remainingSessions ?? 30
        });

        if (profileError) {
            return { success: false, message: profileError.message };
        }

        await client.auth.signOut();
    }
    
    // Add new user
    users.push(userData);
    saveUsers(users);
    
    return { success: true, message: 'Account created successfully! Redirecting to login...' };
}

async function loginUser(idNumber, password, rememberMe = false) {
    const client = getSupabaseClient();
    if (client) {
        const { data: authData, error: authError } = await client.auth.signInWithPassword({
            email: getStudentAuthEmail(idNumber),
            password
        });

        if (authError) {
            return { success: false, message: 'Invalid ID Number or Password. Please try again.' };
        }

        const { data: student, error: studentError } = await client
            .from('students')
            .select('*')
            .eq('user_id', authData.user.id)
            .single();

        if (studentError || !student) {
            return { success: false, message: studentError?.message || 'Student profile was not found.' };
        }

        const user = dbStudentToUser(student);
        saveOrUpdateLocalUser(user);

        setCurrentUser({
            idNumber: user.idNumber,
            firstName: user.firstName,
            lastName: user.lastName,
            course: user.course,
            courseLevel: user.courseLevel
        });

        if (rememberMe) {
            localStorage.setItem(STORAGE_KEYS.REMEMBER_ME, 'true');
        } else {
            localStorage.removeItem(STORAGE_KEYS.REMEMBER_ME);
        }

        return { success: true, message: 'Login successful! Redirecting to dashboard...', user };
    }

    const users = getUsers();
    const user = users.find(u => u.idNumber === idNumber && u.password === password);
    
    if (!user) {
        return { success: false, message: 'Invalid ID Number or Password. Please try again.' };
    }
    
    // Set current user session
    setCurrentUser({
        idNumber: user.idNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        course: user.course,
        courseLevel: user.courseLevel
    });
    
    // Handle remember me
    if (rememberMe) {
        localStorage.setItem(STORAGE_KEYS.REMEMBER_ME, 'true');
    } else {
        localStorage.removeItem(STORAGE_KEYS.REMEMBER_ME);
    }
    
    return { success: true, message: 'Login successful! Redirecting to dashboard...', user: user };
}

function logoutUser() {
    const client = getSupabaseClient();
    if (client) {
        client.auth.signOut();
    }

    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEYS.REMEMBER_ME);
}

function isLoggedIn() {
    return getCurrentUser() !== null;
}

// ============================================
// Admin Database Helper Functions
// ============================================

function getAdmins() {
    const admins = localStorage.getItem(STORAGE_KEYS.ADMINS);
    return safeParseJSON(admins, []);
}

function saveAdmins(admins) {
    localStorage.setItem(STORAGE_KEYS.ADMINS, JSON.stringify(admins));
}

function getCurrentAdmin() {
    const admin = localStorage.getItem(STORAGE_KEYS.ADMIN_CURRENT);
    return safeParseJSON(admin, null);
}

function setCurrentAdmin(admin) {
    if (admin) {
        localStorage.setItem(STORAGE_KEYS.ADMIN_CURRENT, JSON.stringify(admin));
    } else {
        localStorage.removeItem(STORAGE_KEYS.ADMIN_CURRENT);
    }
}

function loginAdmin(username, password, rememberMe = false) {
    const admins = getAdmins();
    const admin = admins.find(a => a.username === username && a.password === password);

    if (!admin) {
        return { success: false, message: 'Invalid username or password.' };
    }

    setCurrentAdmin({
        username: admin.username,
        name: admin.name
    });

    if (rememberMe) {
        localStorage.setItem('ccs_admin_remember', 'true');
    }

    return { success: true, message: 'Login successful! Redirecting to dashboard...', admin: admin };
}

function logoutAdmin() {
    setCurrentAdmin(null);
    localStorage.removeItem('ccs_admin_remember');
}

function isAdminLoggedIn() {
    return getCurrentAdmin() !== null;
}

// ============================================
// Announcements Functions
// ============================================

function getAnnouncements() {
    const announcements = localStorage.getItem(STORAGE_KEYS.ANNOUNCEMENTS);
    return safeParseJSON(announcements, []);
}

function saveAnnouncements(announcements) {
    localStorage.setItem(STORAGE_KEYS.ANNOUNCEMENTS, JSON.stringify(announcements));
}

function addAnnouncement(text) {
    const announcements = getAnnouncements();
    const newAnnouncement = {
        id: Date.now(),
        text: text,
        author: 'CCS Admin',
        date: new Date().toISOString()
    };
    announcements.unshift(newAnnouncement);
    saveAnnouncements(announcements);
    return newAnnouncement;
}

function deleteAnnouncement(id) {
    const announcements = getAnnouncements();
    const filtered = announcements.filter(a => a.id !== id);
    saveAnnouncements(filtered);
}

// ============================================
// Lab Rooms Management Functions
// ============================================

function getDefaultLabRooms() {
    return [
        { id: 'lab-530', name: 'Lab 530', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-524', name: 'Lab 524', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-523', name: 'Lab 523', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-522', name: 'Lab 522', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-521', name: 'Lab 521', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-520', name: 'Lab 520', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-519', name: 'Lab 519', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-518', name: 'Lab 518', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-517', name: 'Lab 517', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-516', name: 'Lab 516', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-515', name: 'Lab 515', capacity: 40, status: 'available', currentOccupancy: 0 },
        { id: 'lab-514', name: 'Lab 514', capacity: 40, status: 'available', currentOccupancy: 0 }
    ];
}

function getLabRooms() {
    const labs = localStorage.getItem(STORAGE_KEYS.LAB_ROOMS);
    if (labs) return safeParseJSON(labs, getDefaultLabRooms());
    return getDefaultLabRooms();
}

function saveLabRooms(labs) {
    localStorage.setItem(STORAGE_KEYS.LAB_ROOMS, JSON.stringify(labs));
}

function updateLabOccupancy() {
    const labs = getLabRooms();
    const currentSitIns = getCurrentSitIns();
    
    // Reset occupancy
    labs.forEach(lab => {
        lab.currentOccupancy = 0;
    });
    
    // Count current sit-ins per lab
    currentSitIns.forEach(sitin => {
        const lab = labs.find(l => l.name === sitin.lab || l.id === sitin.labId);
        if (lab) {
            lab.currentOccupancy++;
            // Update status based on occupancy
            if (lab.currentOccupancy >= lab.capacity) {
                lab.status = 'occupied';
            } else if (lab.currentOccupancy > 0) {
                lab.status = 'available';
            }
        }
    });
    
    // Update lab status
    labs.forEach(lab => {
        if (lab.currentOccupancy === 0 && lab.status !== 'maintenance') {
            lab.status = 'available';
        }
    });
    
    saveLabRooms(labs);
    return labs;
}

function getAvailableLabs() {
    const labs = updateLabOccupancy();
    return labs.filter(lab => lab.status === 'available' && lab.currentOccupancy < lab.capacity);
}

function updateLabStatus(labId, status) {
    const labs = getLabRooms();
    const labIndex = labs.findIndex(l => l.id === labId);
    if (labIndex !== -1) {
        labs[labIndex].status = status;
        saveLabRooms(labs);
    }
}

function addLab(labData) {
    const labs = getLabRooms();
    const newLab = {
        id: labData.id || 'lab-' + Date.now(),
        name: labData.name,
        capacity: labData.capacity || 40,
        status: labData.status || 'available',
        currentOccupancy: 0
    };
    labs.push(newLab);
    saveLabRooms(labs);
    return { success: true, lab: newLab };
}

function deleteLab(labId) {
    const labs = getLabRooms();
    const filtered = labs.filter(l => l.id !== labId);
    saveLabRooms(filtered);
    return { success: true };
}

// ============================================
// Sit-in Records Functions
// ============================================

function getSitInRecords() {
    const records = localStorage.getItem(STORAGE_KEYS.SITIN_RECORDS);
    return safeParseJSON(records, []);
}

function saveSitInRecords(records) {
    localStorage.setItem(STORAGE_KEYS.SITIN_RECORDS, JSON.stringify(records));
}

function getCurrentSitIns() {
    const sitins = localStorage.getItem(STORAGE_KEYS.SITIN_CURRENT);
    return safeParseJSON(sitins, []);
}

function saveCurrentSitIns(sitins) {
    localStorage.setItem(STORAGE_KEYS.SITIN_CURRENT, JSON.stringify(sitins));
}

function addSitIn(sitinData) {
    const sitins = getCurrentSitIns();
    sitins.push(sitinData);
    saveCurrentSitIns(sitins);

    // Update lab occupancy
    updateLabOccupancy();

    // Also save to history
    const records = getSitInRecords();
    records.push({ ...sitinData, status: 'active', completedAt: null });
    saveSitInRecords(records);

    // Note: Sessions are NOT deducted here - only when student checks out
    return { success: true };
}

function addSitInRequest(sitinData) {
    // Add to pending requests instead of active sit-ins
    const requests = getSitinRequests();
    const newRequest = {
        ...sitinData,
        id: Date.now(),
        status: 'pending',
        requestTime: new Date().toISOString()
    };
    requests.push(newRequest);
    saveSitInRequests(requests);
    return { success: true, requestId: newRequest.id };
}

function approveSitInRequest(requestId) {
    const requests = getSitinRequests();
    const requestIndex = requests.findIndex(r => r.id === requestId);

    if (requestIndex === -1) {
        return { success: false, message: 'Request not found.' };
    }

    const request = requests[requestIndex];

    // Remove from requests
    requests.splice(requestIndex, 1);
    saveSitInRequests(requests);

    // Add to active sit-ins
    const activeRequest = {
        ...request,
        status: 'active',
        startTime: new Date().toISOString()
    };
    const sitins = getCurrentSitIns();
    sitins.push(activeRequest);
    saveCurrentSitIns(sitins);

    // Update lab occupancy
    updateLabOccupancy();

    // Save to history
    const records = getSitInRecords();
    records.push(activeRequest);
    saveSitInRecords(records);

    // Note: Sessions are NOT deducted here - only when student checks out
    return { success: true, message: 'Request approved.' };
}

function rejectSitInRequest(requestId) {
    const requests = getSitinRequests();
    const filtered = requests.filter(r => r.id !== requestId);
    saveSitInRequests(filtered);
    return { success: true, message: 'Request rejected.' };
}

function getSitinRequests() {
    const requests = localStorage.getItem('ccs_sitin_requests');
    return safeParseJSON(requests, []);
}

function saveSitInRequests(requests) {
    localStorage.setItem('ccs_sitin_requests', JSON.stringify(requests));
}

function removeSitIn(id) {
    const sitins = getCurrentSitIns();
    const sitin = sitins.find(s => s.id === id);
    const filtered = sitins.filter(s => s.id !== id);
    saveCurrentSitIns(filtered);

    // Update lab occupancy
    updateLabOccupancy();

    // Update history record and deduct session
    if (sitin) {
        const records = getSitInRecords();
        const recordIndex = records.findIndex(r => r.id === id);
        if (recordIndex !== -1) {
            records[recordIndex].status = 'completed';
            records[recordIndex].completedAt = new Date().toISOString();
            records[recordIndex].endTime = new Date().toISOString();
            saveSitInRecords(records);
        }

        // Deduct 1 session from student's remaining sessions
        const users = getUsers();
        const userIndex = users.findIndex(u => u.idNumber === sitin.idNumber);
        if (userIndex !== -1 && users[userIndex].remainingSessions > 0) {
            users[userIndex].remainingSessions--;
            saveUsers(users);
        }
    }

    return { success: true };
}

function checkOutStudent(idNumber) {
    const sitins = getCurrentSitIns();
    const sitin = sitins.find(s => s.idNumber === idNumber && s.status === 'active');
    if (sitin) {
        return removeSitIn(sitin.id);
    }
    return { success: false, message: 'No active session found.' };
}

function getStudentCurrentSitIn(idNumber) {
    const sitins = getCurrentSitIns();
    return sitins.find(s => s.idNumber === idNumber && s.status === 'active');
}

function getStudentHistory(idNumber) {
    const records = getSitInRecords();
    return records.filter(r => r.idNumber === idNumber).sort((a, b) => {
        return new Date(b.startTime) - new Date(a.startTime);
    });
}

// ============================================
// Student Management Functions
// ============================================

async function addStudent(studentData) {
    const users = getUsers();
    const existingIndex = users.findIndex(u => u.idNumber === studentData.idNumber);

    if (existingIndex !== -1) {
        return { success: false, message: 'Student with this ID already exists.' };
    }

    const client = getSupabaseClient();
    if (client) {
        return registerUser({
            ...studentData,
            remainingSessions: studentData.remainingSessions || 30
        });
    }

    const newStudent = {
        ...studentData,
        password: studentData.password || studentData.idNumber,
        remainingSessions: studentData.remainingSessions || 30,
        registeredAt: new Date().toISOString()
    };

    users.push(newStudent);
    saveUsers(users);
    return { success: true, message: 'Student added successfully!' };
}

async function updateStudent(idNumber, studentData) {
    const users = getUsers();
    const userIndex = users.findIndex(u => u.idNumber === idNumber);

    if (userIndex === -1) {
        return { success: false, message: 'Student not found.' };
    }

    const client = getSupabaseClient();
    if (client) {
        const { error } = await client
            .from('students')
            .update({
                id_number: studentData.idNumber,
                first_name: studentData.firstName,
                last_name: studentData.lastName,
                middle_name: studentData.middleName || null,
                email: studentData.email,
                course: studentData.course,
                course_level: studentData.courseLevel,
                address: studentData.address,
                remaining_sessions: studentData.remainingSessions ?? 30
            })
            .eq('id_number', idNumber);

        if (error) return { success: false, message: error.message };
    }

    users[userIndex] = { ...users[userIndex], ...studentData };
    saveUsers(users);
    return { success: true, message: 'Student updated successfully!' };
}

async function deleteStudent(idNumber) {
    const users = getUsers();

    const client = getSupabaseClient();
    if (client) {
        const { error } = await client
            .from('students')
            .delete()
            .eq('id_number', idNumber);

        if (error) return { success: false, message: error.message };
    }

    const filtered = users.filter(u => u.idNumber !== idNumber);
    saveUsers(filtered);

    // Also remove from current sit-ins
    const sitins = getCurrentSitIns();
    const filteredSitins = sitins.filter(s => s.idNumber !== idNumber);
    saveCurrentSitIns(filteredSitins);
    return { success: true, message: 'Student deleted successfully!' };
}

// ============================================
// UI Helper Functions
// ============================================

function showMessage(message, type = 'info') {
    // Remove existing message if any
    const existingMsg = document.querySelector('.custom-message');
    if (existingMsg) {
        existingMsg.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `custom-message message-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        padding: 1rem 2rem;
        border-radius: 8px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        animation: slideDown 0.3s ease-out;
        max-width: 90vw;
        text-align: center;
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideDown {
            from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .message-success { background: #d4edda; color: #155724; border: 2px solid #c3e6cb; }
        .message-error { background: #f8d7da; color: #721c24; border: 2px solid #f5c6cb; }
        .message-info { background: #d1ecf1; color: #0c5460; border: 2px solid #bee5eb; }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(messageDiv);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        messageDiv.style.animation = 'slideDown 0.3s ease-out reverse';
        setTimeout(() => messageDiv.remove(), 300);
    }, 4000);
}

function redirect(url, delay = 1500) {
    setTimeout(() => {
        window.location.href = url;
    }, delay);
}

// ============================================
// Form Event Handlers
// ============================================

function initPasswordToggles() {
    const toggles = document.querySelectorAll('.password-toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('click', function() {
            const targetId = this.dataset.target;
            const input = document.getElementById(targetId);
            if (input) {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                this.textContent = isPassword ? '🙈' : '👁️';
            }
        });
    });
}

function initPasswordStrength() {
    const passwordInput = document.getElementById('password');
    const strengthMeter = document.getElementById('password-strength');
    
    if (!passwordInput || !strengthMeter) return;

    passwordInput.addEventListener('input', function() {
        const password = this.value;
        const strength = calculatePasswordStrength(password);
        
        strengthMeter.className = 'password-strength-meter ' + strength.class;
        strengthMeter.innerHTML = `<div class="password-strength-bar"></div><span class="password-strength-text">${strength.text}</span>`;
    });
}

function calculatePasswordStrength(password) {
    if (!password) return { class: '', text: '' };
    
    let strength = 0;
    
    // Length check
    if (password.length >= 6) strength++;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    
    // Character variety
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    
    if (strength <= 2) return { class: 'weak', text: 'Weak' };
    if (strength <= 4) return { class: 'fair', text: 'Fair' };
    if (strength <= 6) return { class: 'good', text: 'Good' };
    return { class: 'strong', text: 'Strong' };
}

function initRegistrationForm() {
    const form = document.getElementById('registration-form');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Get form values
        const idNumber = document.getElementById('id-number')?.value.trim();
        const lastName = document.getElementById('last-name')?.value.trim();
        const firstName = document.getElementById('first-name')?.value.trim();
        const middleName = document.getElementById('middle-name')?.value.trim();
        const email = document.getElementById('email')?.value.trim();
        const password = document.getElementById('password')?.value;
        const confirmPassword = document.getElementById('confirm-password')?.value;
        const course = document.getElementById('course')?.value;
        const courseLevel = document.getElementById('course-level')?.value;
        const address = document.getElementById('address')?.value.trim();

        // Validation
        if (!idNumber || !lastName || !firstName || !email || !password || !course || !courseLevel || !address) {
            showMessage('Please fill in all required fields.', 'error');
            return;
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showMessage('Please enter a valid email address.', 'error');
            return;
        }

        if (password !== confirmPassword) {
            showMessage('Passwords do not match. Please try again.', 'error');
            return;
        }

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters long.', 'error');
            return;
        }

        // Create user data object
        const userData = {
            idNumber,
            firstName,
            lastName,
            middleName,
            email,
            password, // In production, this should be hashed
            course,
            courseLevel,
            address,
            remainingSessions: 30, // Default 30 sessions for new users
            registeredAt: new Date().toISOString()
        };

        // Register user
        const result = await registerUser(userData);

        if (result.success) {
            showMessage(result.message, 'success');
            redirect('loginpage.html');
        } else {
            showMessage(result.message, 'error');
        }
    });
}

function initLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;

    // Check for remembered ID
    const rememberedId = localStorage.getItem('ccs_remembered_id');
    if (rememberedId) {
        const loginIdInput = document.getElementById('login-id');
        if (loginIdInput) {
            loginIdInput.value = rememberedId;
        }
        const rememberCheckbox = document.querySelector('input[name="remember"]');
        if (rememberCheckbox) {
            rememberCheckbox.checked = true;
        }
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const idNumber = document.getElementById('login-id')?.value.trim();
        const password = document.getElementById('login-password')?.value;
        const rememberMe = document.querySelector('input[name="remember"]')?.checked || false;

        if (!idNumber || !password) {
            showMessage('Please enter both ID Number and Password.', 'error');
            return;
        }

        const result = await loginUser(idNumber, password, rememberMe);

        if (result.success) {
            // Remember ID if checkbox is checked
            if (rememberMe) {
                localStorage.setItem('ccs_remembered_id', idNumber);
            } else {
                localStorage.removeItem('ccs_remembered_id');
            }

            showMessage(result.message, 'success');
            redirect('index.html');
        } else {
            showMessage(result.message, 'error');
        }
    });
}

function updateNavForLoggedInUser() {
    const user = getCurrentUser();
    const nav = document.querySelector('header nav');

    if (!nav) return;

    const loginLink = nav.querySelector('a[href="loginpage.html"]');
    const registerLink = nav.querySelector('a[href="registrationpage.html"]');
    const profileContainer = document.getElementById('nav-profile-container');

    if (user) {
        // User is logged in - hide login/register, show profile
        if (loginLink) loginLink.style.display = 'none';
        if (registerLink) registerLink.style.display = 'none';
        if (profileContainer) {
            profileContainer.style.display = 'inline-flex';

            // Update profile info
            const profileBubble = document.getElementById('profile-bubble');
            const profileDropdown = document.getElementById('profile-dropdown');
            const dropdownAvatar = profileDropdown?.querySelector('.dropdown-avatar');
            const dropdownAvatarImg = profileDropdown?.querySelector('.dropdown-avatar-img');
            const dropdownName = profileDropdown?.querySelector('.dropdown-name');
            const dropdownId = profileDropdown?.querySelector('.dropdown-id');
            const bubbleAvatar = profileBubble?.querySelector('.profile-avatar');
            const bubbleAvatarImg = profileBubble?.querySelector('.profile-avatar-img');
            const bubbleName = profileBubble?.querySelector('.profile-name');

            const avatarInitials = user.firstName.charAt(0) + user.lastName.charAt(0);

            // Get user's profile photo
            const users = getUsers();
            const fullUser = users.find(u => u.idNumber === user.idNumber);
            const hasProfilePhoto = fullUser?.profilePhoto;

            // Update bubble avatar (image or initials)
            if (bubbleAvatarImg && bubbleAvatar) {
                if (hasProfilePhoto) {
                    bubbleAvatarImg.src = fullUser.profilePhoto;
                    bubbleAvatarImg.style.display = 'block';
                    bubbleAvatar.style.display = 'none';
                } else {
                    bubbleAvatarImg.style.display = 'none';
                    bubbleAvatar.style.display = 'flex';
                    bubbleAvatar.textContent = avatarInitials;
                }
            }

            // Update dropdown avatar (image or initials)
            if (dropdownAvatarImg && dropdownAvatar) {
                if (hasProfilePhoto) {
                    dropdownAvatarImg.src = fullUser.profilePhoto;
                    dropdownAvatarImg.style.display = 'block';
                    dropdownAvatar.style.display = 'none';
                } else {
                    dropdownAvatarImg.style.display = 'none';
                    dropdownAvatar.style.display = 'flex';
                    dropdownAvatar.textContent = avatarInitials;
                }
            }

            if (bubbleName) bubbleName.textContent = user.firstName;
            if (dropdownName) dropdownName.textContent = user.firstName + ' ' + user.lastName;
            if (dropdownId) dropdownId.textContent = user.idNumber;

            // Add dropdown toggle functionality (only if not already added)
            if (profileBubble && profileDropdown && !profileBubble.dataset.hasListener) {
                profileBubble.dataset.hasListener = 'true';
                profileBubble.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    profileDropdown.classList.toggle('show');

                    // Update theme toggle text when opening
                    const themeBtn = document.getElementById('theme-toggle-dropdown');
                    if (themeBtn) {
                        const currentTheme = document.documentElement.getAttribute('data-theme');
                        themeBtn.textContent = currentTheme === 'dark' ? 'Light Mode' : 'Dark Mode';
                    }
                });

                // Close dropdown when clicking outside (only add once)
                if (!document.body.dataset.hasDropdownListener) {
                    document.body.dataset.hasDropdownListener = 'true';
                    document.addEventListener('click', function(e) {
                        const allProfileContainers = document.querySelectorAll('.profile-dropdown-container');
                        allProfileContainers.forEach(container => {
                            const dropdown = container.querySelector('.profile-dropdown-menu');
                            if (dropdown && !container.contains(e.target)) {
                                dropdown.classList.remove('show');
                            }
                        });
                    });
                }
            }

            // Theme toggle functionality (only if not already added)
            const themeToggleBtn = document.getElementById('theme-toggle-dropdown');
            if (themeToggleBtn && !themeToggleBtn.dataset.hasListener) {
                themeToggleBtn.dataset.hasListener = 'true';
                themeToggleBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    toggleTheme();
                    const currentTheme = document.documentElement.getAttribute('data-theme');
                    this.textContent = currentTheme === 'dark' ? 'Light Mode' : 'Dark Mode';
                });
            }

            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn && !logoutBtn.dataset.hasListener) {
                logoutBtn.dataset.hasListener = 'true';
                logoutBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    logoutUser();
                    showMessage('You have been logged out successfully.', 'info');
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 1500);
                });
            }
        }
    } else {
        // User is not logged in - show login/register, hide profile
        if (loginLink) loginLink.style.display = '';
        if (registerLink) registerLink.style.display = '';
        if (profileContainer) {
            profileContainer.style.display = 'none';
        }
    }
}

function updateLandingPageForLoggedInUser() {
    const user = getCurrentUser();

    if (!user) return;

    // Hide logged-out view, show logged-in view
    const homeSection = document.getElementById('home');
    const dashboardSection = document.getElementById('dashboard');
    const contentGrid = document.getElementById('content-grid');
    const featuresSection = document.getElementById('features-section');
    const howItWorksSection = document.getElementById('how-it-works-section');

    if (homeSection) homeSection.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = 'block';
    if (contentGrid) contentGrid.style.display = 'grid';
    if (featuresSection) featuresSection.style.display = 'none';
    if (howItWorksSection) howItWorksSection.style.display = 'none';

    // Load announcements for logged-in users
    loadUserAnnouncements();

    // Get full user data including sessions and photo
    const users = getUsers();
    const fullUser = users.find(u => u.idNumber === user.idNumber);

    // Update user info with photo
    const greeting = document.getElementById('user-greeting');
    const studentName = document.getElementById('student-name-display');
    const studentIdCourse = document.getElementById('student-id-course-display');
    const studentEmail = document.getElementById('student-email-display');
    const studentSessions = document.getElementById('student-sessions-display');
    const profilePhoto = document.getElementById('student-profile-photo');
    const avatarPlaceholder = document.getElementById('student-avatar-placeholder');

    if (greeting) greeting.textContent = `Hello, ${user.firstName}!`;
    if (studentName) studentName.textContent = `${user.firstName} ${user.lastName}`;
    if (studentIdCourse) studentIdCourse.textContent = `${user.idNumber} | ${user.course} - ${user.courseLevel}${getYearSuffix(user.courseLevel)} Year`;
    if (studentEmail) studentEmail.textContent = fullUser?.email || 'No email provided';
    const remainingSessions = fullUser?.remainingSessions ?? 30;
    if (studentSessions) {
        studentSessions.textContent = remainingSessions;
    }

    // Update sessions progress bar
    const sessionsBar = document.getElementById('sessions-bar');
    if (sessionsBar) {
        const pct = Math.max(0, Math.min(100, (remainingSessions / 30) * 100));
        sessionsBar.style.width = pct + '%';
    }

    // Populate sit-in history
    loadStudentSitinHistory(user.idNumber);

    // Load new dashboard sections
    loadUserSitinSummary(user.idNumber);
    loadSitinHistory(user.idNumber);
    loadUserLabAvailability();
    updateStudentReservationStatus();
    loadLandingLeaderboard(user.idNumber);

    // Handle profile photo
    if (fullUser?.profilePhoto) {
        if (profilePhoto) {
            profilePhoto.src = fullUser.profilePhoto;
            profilePhoto.style.display = 'block';
        }
        if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
    } else {
        if (profilePhoto) profilePhoto.style.display = 'none';
        if (avatarPlaceholder) {
            avatarPlaceholder.style.display = 'flex';
            avatarPlaceholder.textContent = (user.firstName?.charAt(0) || 'U') + (user.lastName?.charAt(0) || 'S');
        }
    }

    // Add logout functionality to nav logout button
    const logoutBtnNav = document.getElementById('logout-btn-nav');
    if (logoutBtnNav && !logoutBtnNav.dataset.hasListener) {
        logoutBtnNav.dataset.hasListener = 'true';
        logoutBtnNav.addEventListener('click', function(e) {
            e.preventDefault();
            logoutUser();
            showMessage('You have been logged out successfully.', 'info');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        });
    }

    // Reserve a lab modal
    const makeReservationBtn = document.getElementById('make-reservation-btn');
    if (makeReservationBtn && !makeReservationBtn.dataset.hasListener) {
        makeReservationBtn.dataset.hasListener = 'true';
        makeReservationBtn.addEventListener('click', function() {
            openReserveModal(user);
        });
    }

    // Lab availability modal
    const viewLabsBtn = document.getElementById('view-labs-btn');
    if (viewLabsBtn && !viewLabsBtn.dataset.hasListener) {
        viewLabsBtn.dataset.hasListener = 'true';
        const labModal = document.getElementById('lab-avail-modal');
        viewLabsBtn.addEventListener('click', () => { labModal.style.display = 'flex'; });
        document.getElementById('lab-avail-modal-close').onclick = () => { labModal.style.display = 'none'; };
        labModal.addEventListener('click', (e) => { if (e.target === labModal) labModal.style.display = 'none'; });
    }

    // Notification bell
    initNotificationBell(user.idNumber);
}

// ============================================
// Reserve Lab Modal (Landing Page)
// ============================================

function openReserveModal(user) {
    if (!isReservationEnabled()) {
        showMessage('Reservations are currently disabled by the administrator.', 'error');
        return;
    }

    const modal = document.getElementById('reserve-modal');
    const labSelect = document.getElementById('reserve-lab');
    if (!modal || !labSelect) return;

    const labs = getLabRooms().filter(l => l.status !== 'maintenance' && l.status !== 'closed');
    labSelect.innerHTML = '<option value="">-- Choose an available lab --</option>';
    if (labs.length === 0) {
        labSelect.innerHTML = '<option value="" disabled>No labs available right now</option>';
    } else {
        labs.forEach(lab => {
            const opt = document.createElement('option');
            opt.value = lab.id;
            const statusNote = lab.status === 'available' ? '' : ` — ${lab.status}`;
            opt.textContent = `${lab.name} (Cap: ${lab.capacity || 'N/A'}${statusNote})`;
            labSelect.appendChild(opt);
        });
    }

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    const reserveDateInput = document.getElementById('reserve-date');
    if (reserveDateInput) reserveDateInput.value = today;

    modal.style.display = 'flex';
    const purposeInput = document.getElementById('reserve-purpose');
    const notesInput = document.getElementById('reserve-notes');
    const startInput = document.getElementById('reserve-start-time');
    const endInput = document.getElementById('reserve-end-time');
    if (purposeInput) purposeInput.value = '';
    if (notesInput) notesInput.value = '';
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';

    // Software preview on lab select
    const softwareHint = document.getElementById('reserve-software-hint');
    labSelect.onchange = function() {
        if (!softwareHint) return;
        const lab = getLabRooms().find(l => l.id === this.value);
        const sw = lab?.software || [];
        softwareHint.innerHTML = sw.length > 0
            ? sw.map(s => `<span class="ulab-software-tag">${escapeHTML(s)}</span>`).join('')
            : '';
    };
    if (softwareHint) softwareHint.innerHTML = '';

    const closeBtn = document.getElementById('reserve-modal-close');
    const cancelBtn = document.getElementById('reserve-modal-cancel');
    const closeModal = () => { modal.style.display = 'none'; };
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    const form = document.getElementById('reserve-form');
    form.onsubmit = function(e) {
        e.preventDefault();
        const selectedLabId = labSelect.value;
        const selectedLab = getLabRooms().find(l => l.id === selectedLabId);
        const purpose = document.getElementById('reserve-purpose').value.trim();
        const notes = document.getElementById('reserve-notes').value.trim();
        const resDate = document.getElementById('reserve-date')?.value || new Date().toISOString().split('T')[0];
        const startTime = document.getElementById('reserve-start-time')?.value || null;
        const endTime = document.getElementById('reserve-end-time')?.value || null;

        if (!selectedLabId) { showMessage('Please select a lab.', 'error'); return; }
        if (!purpose) { showMessage('Please enter a purpose.', 'error'); return; }
        if (!resDate) { showMessage('Please select a date.', 'error'); return; }
        if (!startTime) { showMessage('Please enter a start time.', 'error'); return; }
        if (!endTime) { showMessage('Please enter an end time.', 'error'); return; }
        if (startTime >= endTime) { showMessage('End time must be after start time.', 'error'); return; }

        // Check for duplicate pending reservation
        const existing = getReservations().find(r => r.studentId === user.idNumber && r.status === 'pending');
        if (existing) {
            showMessage('You already have a pending reservation. Please wait for admin review.', 'error');
            return;
        }

        const result = addReservation({
            studentId: user.idNumber,
            studentName: `${user.firstName} ${user.lastName}`,
            lab: selectedLab?.name || selectedLabId,
            date: resDate,
            startTime: startTime,
            endTime: endTime,
            purpose,
            notes
        });

        if (result.success) {
            closeModal();
            showMessage('Reservation request submitted! Admin will review it shortly.', 'success');
        } else {
            showMessage('Failed to submit request. Please try again.', 'error');
        }
    };
}

// ============================================
// Notification Bell (Landing Page)
// ============================================

function getNotifReadIds() {
    const data = localStorage.getItem('ccs_notif_read');
    return data ? JSON.parse(data) : [];
}

function markNotifRead(ids) {
    const existing = getNotifReadIds();
    const merged = [...new Set([...existing, ...ids])];
    localStorage.setItem('ccs_notif_read', JSON.stringify(merged));
}

function getStudentNotifications(studentId) {
    const reservations = getReservations().filter(r => r.studentId === studentId);
    const notifs = [];
    reservations.forEach(r => {
        if (r.status === 'approved') {
            notifs.push({ id: 'res-' + r.id, type: 'success', message: `Your reservation for ${r.lab} was approved.`, time: r.reviewedAt || r.createdAt });
        } else if (r.status === 'rejected') {
            notifs.push({ id: 'res-' + r.id, type: 'error', message: `Your reservation for ${r.lab} was rejected.`, time: r.reviewedAt || r.createdAt });
        }
    });
    return notifs.sort((a, b) => new Date(b.time) - new Date(a.time));
}

function initNotificationBell(studentId) {
    const bellContainer = document.getElementById('notif-bell-container');
    const bellBtn = document.getElementById('notif-bell-btn');
    const bellDropdown = document.getElementById('notif-dropdown');
    const notifList = document.getElementById('notif-list');
    const notifCount = document.getElementById('notif-count');
    if (!bellContainer || !bellBtn) return;

    bellContainer.style.display = 'flex';

    function renderNotifs() {
        const notifs = getStudentNotifications(studentId);
        const readIds = getNotifReadIds();
        const unread = notifs.filter(n => !readIds.includes(n.id));

        if (unread.length > 0) {
            notifCount.textContent = unread.length;
            notifCount.style.display = 'flex';
        } else {
            notifCount.style.display = 'none';
        }

        if (notifs.length === 0) {
            notifList.innerHTML = '<p class="notif-empty">No notifications yet.</p>';
            return;
        }

        notifList.innerHTML = notifs.map(n => {
            const isUnread = !readIds.includes(n.id);
            const timeStr = n.time ? new Date(n.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            return `<div class="notif-item ${isUnread ? 'notif-unread' : ''} notif-type-${n.type}">
                <span class="notif-dot"></span>
                <div class="notif-body">
                    <p class="notif-msg">${n.message}</p>
                    <span class="notif-time">${timeStr}</span>
                </div>
            </div>`;
        }).join('');
    }

    renderNotifs();

    bellBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = bellDropdown.classList.toggle('show');
        if (isOpen) {
            const notifs = getStudentNotifications(studentId);
            markNotifRead(notifs.map(n => n.id));
            renderNotifs();
        }
    });

    document.addEventListener('click', function(e) {
        if (!bellContainer.contains(e.target)) {
            bellDropdown.classList.remove('show');
        }
    });
}

// ============================================
// Student Sit-in History (Landing Page)
// ============================================

function loadStudentSitinHistory(studentIdNumber) {
    // Wire the top-level feedback button regardless of history state
    const openFeedbackBtn = document.getElementById('open-feedback-btn');
    if (openFeedbackBtn && !openFeedbackBtn.dataset.hasListener) {
        openFeedbackBtn.dataset.hasListener = 'true';
        openFeedbackBtn.addEventListener('click', () => {
            openSitinFeedbackModal('', '', studentIdNumber);
        });
    }

    const historyList = document.getElementById('history-list');
    if (!historyList) return;

    const records = getSitInRecords().map(r => ({ ...r, status: r.status || 'completed' }));
    const active = getCurrentSitIns().map(s => ({ ...s, status: 'active' }));
    const allSitins = [...active, ...records];
    const dedupedSitins = Array.from(
        new Map(
            allSitins.map(s => {
                const dedupeKey = s.id ?? `${s.idNumber}-${s.lab}-${s.startTime}`;
                return [dedupeKey, s];
            })
        ).values()
    );
    const studentHistory = dedupedSitins
        .filter(s => s.idNumber === studentIdNumber)
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
        .slice(0, 8);

    if (studentHistory.length === 0) {
        historyList.innerHTML = '<p class="no-history-msg">No sit-in history yet.</p>';
        return;
    }

    historyList.innerHTML = studentHistory.map(entry => {
        const statusClass = entry.status === 'active' ? 'status-active' : 'status-completed';
        const startDate = entry.startTime ? new Date(entry.startTime) : null;
        const dateStr = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A';
        const timeStr = startDate ? startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        const initials = (entry.lab || 'L').substring(0, 2).toUpperCase();

        return `
            <div class="history-entry ${statusClass}">
                <div class="history-entry-icon">${initials}</div>
                <div class="history-entry-info">
                    <span class="history-entry-lab">${entry.lab || 'Unknown Lab'}</span>
                    <span class="history-entry-purpose">${entry.purpose || 'General'}</span>
                </div>
                <div class="history-entry-meta">
                    <span class="history-entry-date">${dateStr}</span>
                    <span class="history-entry-time">${timeStr}</span>
                </div>
                <span class="status-badge status-${entry.status || 'completed'}">${entry.status === 'active' ? 'Active' : 'Done'}</span>
            </div>`;
    }).join('');

}

// ============================================
// Student Dashboard - Sit-In Summary
// ============================================

function loadUserSitinSummary(studentId) {
    const records = getSitInRecords().filter(r => r.idNumber === studentId && r.status === 'completed');

    const totalMs = records.reduce((sum, r) => {
        if (r.startTime && r.endTime) return sum + (new Date(r.endTime) - new Date(r.startTime));
        return sum;
    }, 0);
    const totalHours = (totalMs / 3600000).toFixed(1);
    const avgMs = records.length > 0 ? totalMs / records.length : 0;
    const avgMins = Math.round(avgMs / 60000);

    let longestMs = 0;
    records.forEach(r => {
        if (r.startTime && r.endTime) {
            const dur = new Date(r.endTime) - new Date(r.startTime);
            if (!isNaN(dur) && dur > longestMs) longestMs = dur;
        }
    });
    const longestMins = Math.round(longestMs / 60000);
    const formatMins = m => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('sum-total-hours', totalHours + 'h');
    setEl('sum-sessions', records.length);
    setEl('sum-avg-duration', avgMins > 0 ? formatMins(avgMins) : 'N/A');
    setEl('sum-longest', longestMins > 0 ? formatMins(longestMins) : 'N/A');
}

// ============================================
// Student Dashboard - Session Table
// ============================================

function loadUserSessionTable(studentId) {
    const tbody = document.getElementById('user-session-tbody');
    if (!tbody) return;

    const records = getSitInRecords().filter(r => r.idNumber === studentId);
    const currentSitIns = getCurrentSitIns()
        .filter(s => s.idNumber === studentId && s.status === 'active')
        .map(s => ({ ...s, status: 'active' }));

    const allSessions = [...currentSitIns, ...records];
    const deduped = Array.from(
        new Map(allSessions.map(s => [s.id ?? `${s.idNumber}-${s.startTime}`, s])).values()
    );
    const sorted = deduped.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-table-msg">No sessions yet.</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(s => {
        const startDate = s.startTime ? new Date(s.startTime) : null;
        const endDate = s.endTime ? new Date(s.endTime) : null;
        const dateStr = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
        const timeInStr = startDate ? startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const timeOutStr = endDate ? endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : (s.status === 'active' ? 'Active' : 'N/A');
        const durStr = startDate && endDate ? calculateDuration(s.startTime, s.endTime) : (s.status === 'active' ? 'In progress' : 'N/A');
        const pcNo = s.pcNumber || s.pc || '—';
        return `<tr>
            <td>${dateStr}</td>
            <td>${timeInStr}</td>
            <td>${timeOutStr}</td>
            <td>${durStr}</td>
            <td>${escapeHTML(String(pcNo))}</td>
            <td><span class="status-badge status-${s.status || 'completed'}">${s.status || 'completed'}</span></td>
        </tr>`;
    }).join('');
}

// ============================================
// Student Dashboard - Sit-in History
// ============================================

function loadSitinHistory(studentId) {
    const tbody = document.getElementById('sitin-history-tbody');
    if (!tbody) return;

    const records = getSitInRecords().filter(r => r.idNumber === studentId);
    const sorted = records.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-table-msg">No sit-in history yet.</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(s => {
        const startDate = s.startTime ? new Date(s.startTime) : null;
        const endDate   = s.endTime   ? new Date(s.endTime)   : null;
        const dateStr   = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
        const timeInStr = startDate ? startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const timeOutStr = endDate  ? endDate.toLocaleTimeString('en-US',   { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const durStr    = startDate && endDate ? calculateDuration(s.startTime, s.endTime) : 'N/A';
        return `<tr>
            <td>${dateStr}</td>
            <td>${escapeHTML(s.lab || s.labName || '—')}</td>
            <td>${escapeHTML(s.purpose || '—')}</td>
            <td>${timeInStr}</td>
            <td>${timeOutStr}</td>
            <td>${durStr}</td>
        </tr>`;
    }).join('');
}

// ============================================
// Admin - Sessions Table
// ============================================

function loadAdminSessionsTable() {
    const tbody = document.getElementById('admin-sessions-tbody');
    if (!tbody) return;

    const records = getSitInRecords();
    const students = getUsers();
    const sorted = records.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table-msg">No completed sessions yet.</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(s => {
        const student   = students.find(st => st.idNumber === s.idNumber);
        const name      = student ? `${student.firstName} ${student.lastName}` : s.idNumber;
        const startDate = s.startTime ? new Date(s.startTime) : null;
        const endDate   = s.endTime   ? new Date(s.endTime)   : null;
        const dateStr   = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
        const timeInStr = startDate ? startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const timeOutStr = endDate  ? endDate.toLocaleTimeString('en-US',   { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        return `<tr>
            <td>${dateStr}</td>
            <td>${escapeHTML(s.idNumber)}</td>
            <td>${escapeHTML(name)}</td>
            <td>${escapeHTML(s.lab || s.labName || '—')}</td>
            <td>${escapeHTML(s.purpose || '—')}</td>
            <td>${timeInStr}</td>
            <td>${timeOutStr}</td>
        </tr>`;
    }).join('');
}

// ============================================
// Student Dashboard - Lab Availability
// ============================================

function loadUserLabAvailability() {
    const container = document.getElementById('user-lab-availability');
    if (!container) return;

    const labs = updateLabOccupancy();
    if (!labs || labs.length === 0) {
        container.innerHTML = '<p class="no-history-msg">No lab data available.</p>';
        return;
    }

    container.innerHTML = labs.map(lab => {
        const pct = lab.capacity > 0 ? Math.min(100, Math.round((lab.currentOccupancy / lab.capacity) * 100)) : 0;
        const isUnavailable = lab.status === 'maintenance' || lab.status === 'closed';
        const isFull = !isUnavailable && pct >= 100;
        const statusClass = isUnavailable ? 'ulab-maintenance' : isFull ? 'ulab-full' : 'ulab-available';
        const statusText = isUnavailable ? lab.status : isFull ? 'Full' : 'Available';
        const softwareTags = (lab.software || []).length > 0
            ? `<div class="ulab-software">${(lab.software).map(s => `<span class="ulab-software-tag">${escapeHTML(s)}</span>`).join('')}</div>`
            : '';
        return `<div class="user-lab-item ${statusClass}">
            <div class="ulab-header">
                <span class="ulab-name">${escapeHTML(lab.name)}</span>
                <span class="ulab-status-badge">${statusText}</span>
            </div>
            <div class="ulab-bar-wrap">
                <div class="ulab-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="ulab-count">${lab.currentOccupancy}/${lab.capacity} seats occupied</span>
            ${softwareTags}
        </div>`;
    }).join('');
}

// ============================================
// Student Dashboard - Reservation Status
// ============================================

function updateStudentReservationStatus() {
    const badge = document.getElementById('res-status-badge');
    const makeReservationBtn = document.getElementById('make-reservation-btn');
    const enabled = isReservationEnabled();

    if (badge) {
        badge.textContent = enabled ? 'Open' : 'Closed';
        badge.className = 'res-status-badge ' + (enabled ? 'res-open' : 'res-closed');
    }

    if (makeReservationBtn) {
        makeReservationBtn.disabled = !enabled;
        makeReservationBtn.title = enabled ? '' : 'Reservations are currently closed by the administrator.';
        makeReservationBtn.style.opacity = enabled ? '1' : '0.5';
    }
}

function openSitinFeedbackModal(sitinId, lab, studentIdNumber) {
    const modal = document.getElementById('sitin-feedback-modal');
    if (!modal) return;

    document.getElementById('feedback-sitin-id').value = sitinId;
    document.getElementById('feedback-sitin-lab').value = lab;
    document.getElementById('feedback-message').value = '';
    document.getElementById('feedback-rating').value = '0';

    // Reset stars
    document.querySelectorAll('#star-rating .star').forEach(s => s.classList.remove('active'));

    modal.style.display = 'flex';

    const close = () => { modal.style.display = 'none'; };
    document.getElementById('sitin-feedback-close').onclick = close;
    document.getElementById('sitin-feedback-cancel').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };

    // Star rating interaction
    const stars = document.querySelectorAll('#star-rating .star');
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const val = parseInt(this.dataset.val);
            document.getElementById('feedback-rating').value = val;
            stars.forEach((s, i) => s.classList.toggle('active', i < val));
        });
        star.addEventListener('mouseenter', function() {
            const val = parseInt(this.dataset.val);
            stars.forEach((s, i) => s.classList.toggle('hover', i < val));
        });
        star.addEventListener('mouseleave', function() {
            stars.forEach(s => s.classList.remove('hover'));
        });
    });

    // Submit
    const form = document.getElementById('sitin-feedback-form');
    form.onsubmit = function(e) {
        e.preventDefault();
        const user = getCurrentUser();
        const users = getUsers();
        const fullUser = users.find(u => u.idNumber === studentIdNumber);
        const message = document.getElementById('feedback-message').value.trim();
        const rating = parseInt(document.getElementById('feedback-rating').value) || 0;

        if (!message) { showMessage('Please enter your feedback.', 'error'); return; }

        addFeedback({
            studentId: studentIdNumber,
            studentName: user ? `${user.firstName} ${user.lastName}` : studentIdNumber,
            email: fullUser?.email || '',
            type: 'sit-in',
            subject: lab ? `Sit-in Feedback - ${lab}` : 'Sit-in Feedback',
            message,
            rating
        });

        close();
        showMessage('Feedback submitted successfully!', 'success');
    };
}

// ============================================
// Feedback Form Functions (Student-facing)
// ============================================

function initFeedbackForm() {
    const feedbackForm = document.getElementById('student-feedback-form');
    if (!feedbackForm) return;

    const user = getCurrentUser();
    if (!user) {
        // Hide form if not logged in, show login prompt
        feedbackForm.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">Please <a href="loginpage.html" style="color: var(--primary-blue);">log in</a> to submit feedback.</p>';
        return;
    }

    // Populate user info
    const nameInput = document.getElementById('feedback-name');
    const idInput = document.getElementById('feedback-id');
    const emailInput = document.getElementById('feedback-email');

    if (nameInput) nameInput.value = `${user.firstName} ${user.lastName}`;
    if (idInput) idInput.value = user.idNumber;
    
    // Try to get email from full user data
    const users = getUsers();
    const fullUser = users.find(u => u.idNumber === user.idNumber);
    if (emailInput && fullUser?.email) {
        emailInput.value = fullUser.email;
    }

    // Form submit handler
    feedbackForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const feedbackData = {
            studentId: user.idNumber,
            studentName: `${user.firstName} ${user.lastName}`,
            email: emailInput?.value.trim() || '',
            type: document.getElementById('feedback-type').value,
            subject: document.getElementById('feedback-subject').value.trim(),
            message: document.getElementById('feedback-message').value.trim(),
            rating: parseInt(document.querySelector('input[name="rating"]:checked')?.value || 0)
        };

        // Validation
        if (!feedbackData.type || !feedbackData.subject || !feedbackData.message) {
            showMessage('Please fill in all required fields.', 'error');
            return;
        }

        // Submit feedback
        const result = addFeedback(feedbackData);

        if (result.success) {
            showMessage('Thank you for your feedback! We appreciate your input.', 'success');
            feedbackForm.reset();
            // Re-populate user info
            if (nameInput) nameInput.value = `${user.firstName} ${user.lastName}`;
            if (idInput) idInput.value = user.idNumber;
            if (emailInput && fullUser?.email) emailInput.value = fullUser.email;
        } else {
            showMessage(result.message || 'Error submitting feedback. Please try again.', 'error');
        }
    });
}

// ============================================
// Feedback Page Functions (Standalone Page)
// ============================================

function initFeedbackPage() {
    const user = getCurrentUser();

    // Check if user is logged in
    if (!user) {
        showMessage('Please log in to submit feedback.', 'error');
        setTimeout(() => {
            window.location.href = 'loginpage.html';
        }, 2000);
        return;
    }

    const feedbackForm = document.getElementById('student-feedback-form');
    if (!feedbackForm) return;

    // Populate user info
    const nameInput = document.getElementById('feedback-name');
    const idInput = document.getElementById('feedback-id');
    const emailInput = document.getElementById('feedback-email');

    if (nameInput) nameInput.value = `${user.firstName} ${user.lastName}`;
    if (idInput) idInput.value = user.idNumber;

    // Try to get email from full user data
    const users = getUsers();
    const fullUser = users.find(u => u.idNumber === user.idNumber);
    if (emailInput && fullUser?.email) {
        emailInput.value = fullUser.email;
    }

    // Form submit handler
    feedbackForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const feedbackData = {
            studentId: user.idNumber,
            studentName: `${user.firstName} ${user.lastName}`,
            email: emailInput?.value.trim() || '',
            type: document.getElementById('feedback-type').value,
            subject: document.getElementById('feedback-subject').value.trim(),
            message: document.getElementById('feedback-message').value.trim(),
            rating: parseInt(document.querySelector('input[name="rating"]:checked')?.value || 0)
        };

        // Validation
        if (!feedbackData.type || !feedbackData.subject || !feedbackData.message) {
            showMessage('Please fill in all required fields.', 'error');
            return;
        }

        // Submit feedback
        const result = addFeedback(feedbackData);

        if (result.success) {
            showMessage('Thank you for your feedback! We appreciate your input.', 'success');
            feedbackForm.reset();
            // Re-populate user info
            if (nameInput) nameInput.value = `${user.firstName} ${user.lastName}`;
            if (idInput) idInput.value = user.idNumber;
            if (emailInput && fullUser?.email) emailInput.value = fullUser.email;
        } else {
            showMessage(result.message || 'Error submitting feedback. Please try again.', 'error');
        }
    });
}

function getYearSuffix(year) {
    const suffixes = ['st', 'nd', 'rd', 'th', 'th'];
    return suffixes[parseInt(year) - 1] || 'th';
}

// ============================================
// Security & Safety Helpers
// ============================================

function escapeHTML(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeParseJSON(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch (e) { return fallback; }
}

function csvEscape(val) {
    const s = String(val == null ? '' : val);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

// ============================================
// Reservation Enable/Disable
// ============================================

function isReservationEnabled() {
    const val = localStorage.getItem(STORAGE_KEYS.RESERVATION_ENABLED);
    return val === null || val === 'true';
}

function setReservationEnabled(enabled) {
    localStorage.setItem(STORAGE_KEYS.RESERVATION_ENABLED, enabled ? 'true' : 'false');
}

// ============================================
// Dark Mode / Theme Functions
// ============================================

function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
    
    return theme;
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const themeBtn = document.getElementById('theme-toggle-dropdown');
    if (themeBtn) {
        themeBtn.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }
}

function initThemeToggle() {
    // Theme toggle is now in the profile dropdown
    // It gets initialized when the user logs in
}

// ============================================
// Admin Page Functions
// ============================================

function initAdminDropdowns() {
    // Add click toggle functionality for admin dropdowns
    const dropdowns = document.querySelectorAll('.admin-dropdown');
    dropdowns.forEach(dropdown => {
        const toggle = dropdown.querySelector('.dropdown-toggle');
        if (toggle) {
            toggle.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Close all other dropdowns
                dropdowns.forEach(d => {
                    if (d !== dropdown) {
                        d.classList.remove('show-dropdown');
                    }
                });
                
                // Toggle this dropdown
                dropdown.classList.toggle('show-dropdown');
            });
        }
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        const dropdowns = document.querySelectorAll('.admin-dropdown');
        dropdowns.forEach(dropdown => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('show-dropdown');
            }
        });
    });
}

function initAdminLogin() {
    const form = document.getElementById('adminLoginForm');
    if (!form) return;

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        const username = document.getElementById('admin-username').value.trim();
        const password = document.getElementById('admin-password').value;
        const rememberMe = document.querySelector('input[name="remember"]')?.checked || false;

        const result = loginAdmin(username, password, rememberMe);
        if (result.success) {
            showMessage(result.message, 'success');
            setTimeout(() => {
                window.location.href = 'admindashboard.html';
            }, 1500);
        } else {
            showMessage(result.message, 'error');
        }
    });
}

function initAdminDashboard() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    // Initialize admin dropdowns
    initAdminDropdowns();

    // Load statistics
    loadDashboardStats();

    // Load sessions table
    loadAdminSessionsTable();

    // Load announcements
    loadAnnouncements();

    // Load analytics and leaderboard
    loadDashboardAnalytics();
    loadDashboardLeaderboard();

    // Reservation toggle
    updateReservationToggleUI();
    const rtbToggleBtn = document.getElementById('rtb-toggle-btn');
    if (rtbToggleBtn && !rtbToggleBtn.dataset.hasListener) {
        rtbToggleBtn.dataset.hasListener = 'true';
        rtbToggleBtn.addEventListener('click', function() {
            const currentlyEnabled = isReservationEnabled();
            const newState = !currentlyEnabled;
            setReservationEnabled(newState);
            updateReservationToggleUI();
            showMessage(`Reservations ${newState ? 'enabled' : 'disabled'} successfully.`, newState ? 'success' : 'info');
        });
    }

    // Leaderboard search and sort
    const lbSearch = document.getElementById('leaderboard-search');
    const lbSort = document.getElementById('leaderboard-sort');
    if (lbSearch) lbSearch.addEventListener('input', loadDashboardLeaderboard);
    if (lbSort) lbSort.addEventListener('change', loadDashboardLeaderboard);

    // Init announcement form
    const announcementForm = document.getElementById('announcementForm');
    if (announcementForm) {
        announcementForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const text = document.getElementById('announcement-text').value;
            addAnnouncement(text);
            document.getElementById('announcement-text').value = '';
            loadAnnouncements();
            showMessage('Announcement posted successfully!', 'success');
        });
    }

    // Init logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }

    // Init search nav
    const searchNav = document.getElementById('nav-search');
    if (searchNav) {
        searchNav.addEventListener('click', function(e) {
            e.preventDefault();
            const searchModal = document.getElementById('search-modal');
            if (searchModal) searchModal.style.display = 'flex';
        });
    }

    // Search modal close button
    const searchModalClose = document.getElementById('search-modal-close');
    const searchModal = document.getElementById('search-modal');
    if (searchModalClose && searchModal) {
        searchModalClose.addEventListener('click', () => searchModal.style.display = 'none');
    }

    // Search form submit
    const searchForm = document.getElementById('search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const searchTerm = document.getElementById('search-input').value.trim();
            if (!searchTerm) return;

            const users = getUsers();
            const results = users.filter(u =>
                u.idNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (u.firstName + ' ' + u.lastName).toLowerCase().includes(searchTerm.toLowerCase())
            );

            const resultsDiv = document.getElementById('search-results');
            if (resultsDiv) {
                if (results.length === 0) {
                    resultsDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No students found.</p>';
                } else {
                    resultsDiv.innerHTML = results.map(u => `
                        <div style="padding: 0.75rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong>${u.firstName} ${u.lastName}</strong><br>
                                <small style="color: var(--text-muted);">${u.idNumber} | ${u.course}</small>
                            </div>
                            <a href="adminstudents.html" style="color: var(--primary-blue); text-decoration: none; font-size: 0.85rem;">View</a>
                        </div>
                    `).join('');
                }
            }
        });
    }

    // Close search modal when clicking outside
    if (searchModal) {
        searchModal.addEventListener('click', function(e) {
            if (e.target === searchModal) {
                searchModal.style.display = 'none';
            }
        });
    }
}

function loadDashboardStats() {
    const users = getUsers();
    const sitIns = getCurrentSitIns();
    const totalStudents = users.length;
    const currentSitIn = sitIns.length;
    const totalSitIns = getSitInRecords().length;

    const totalStudentsEl = document.getElementById('total-students');
    const currentSitInEl = document.getElementById('current-sitin');
    const totalSitInsEl = document.getElementById('total-sitins');

    if (totalStudentsEl) totalStudentsEl.textContent = totalStudents;
    if (currentSitInEl) currentSitInEl.textContent = currentSitIn;
    if (totalSitInsEl) totalSitInsEl.textContent = totalSitIns;

    // Create course chart
    createCourseChart(users);
}

function createCourseChart(users) {
    const ctx = document.getElementById('courseChart');
    if (!ctx) return;

    // Count students by course
    const courseCounts = {};
    const courseColors = {
        'BSIT': '#1877F2',
        'BSCS': '#833AB4',
        'BSIS': '#E1306C',
        'ACT': '#F7B731',
        'CpE': '#FD1D1D',
        'CE': '#00C853',
        'ME': '#FF9800',
        'EE': '#9C27B0',
        'IE': '#00BCD4',
        'NAME': '#795548',
        'BEEd': '#E91E63',
        'BSEd': '#3F51B5',
        'CRIM': '#607D8B',
        'COMM': '#009688',
        'ACCT': '#FF5722',
        'HRM': '#CDDC39',
        'CA': '#673AB7',
        'CS': '#03A9F4',
        'IP': '#FFC107',
        'ABPS': '#8BC34A',
        'ABENG': '#FF4081'
    };

    users.forEach(user => {
        const course = user.course || 'Unknown';
        courseCounts[course] = (courseCounts[course] || 0) + 1;
    });

    const labels = Object.keys(courseCounts);
    const data = Object.values(courseCounts);
    const colors = labels.map(c => courseColors[c] || '#999');

    // Update legend
    const legendEl = document.getElementById('course-legend');
    if (legendEl) {
        legendEl.innerHTML = labels.map((c, i) => `
            <span class="legend-item">
                <span class="legend-color" style="background: ${colors[i]}"></span>
                ${c} (${data[i]})
            </span>
        `).join('');
    }

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function loadAnnouncements() {
    const announcementsList = document.getElementById('announcements-list');
    if (!announcementsList) return;

    const announcements = getAnnouncements();
    
    const existingList = announcementsList.querySelector('.announcements-inner');
    if (existingList) existingList.remove();

    const innerDiv = document.createElement('div');
    innerDiv.className = 'announcements-inner';
    
    if (announcements.length === 0) {
        innerDiv.innerHTML = '<p class="no-announcements">No announcements yet.</p>';
    } else {
        innerDiv.innerHTML = announcements.map(a => `
            <div class="announcement-item">
                <div class="announcement-meta">
                    <span class="announcement-author">${a.author}</span>
                    <span class="announcement-date">${new Date(a.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                <p class="announcement-text">${escapeHTML(a.text)}</p>
                <button class="btn-delete-announcement" data-id="${a.id}">Delete</button>
            </div>
        `).join('');
    }

    announcementsList.appendChild(innerDiv);

    // Add delete handlers
    innerDiv.querySelectorAll('.btn-delete-announcement').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = parseInt(this.dataset.id);
            deleteAnnouncement(id);
            loadAnnouncements();
            showMessage('Announcement deleted!', 'info');
        });
    });
}

function updateReservationToggleUI() {
    const enabled = isReservationEnabled();
    const statusText = document.getElementById('rtb-status-text');
    const toggleBtn = document.getElementById('rtb-toggle-btn');
    if (statusText) {
        statusText.textContent = enabled ? 'Enabled' : 'Disabled';
        statusText.className = 'rtb-status ' + (enabled ? 'rtb-enabled' : 'rtb-disabled');
    }
    if (toggleBtn) {
        toggleBtn.textContent = enabled ? 'Disable Reservations' : 'Enable Reservations';
        toggleBtn.className = 'btn ' + (enabled ? 'admin-clear-btn' : 'admin-submit-btn');
    }
}

// ============================================
// Admin Dashboard - Analytics
// ============================================

function loadDashboardAnalytics() {
    const users = getUsers();
    const records = getSitInRecords();
    const currentSitIns = getCurrentSitIns();
    const reservations = getReservations();
    const labs = getLabRooms();
    const feedbackList = getFeedback();

    const completedRecords = records.filter(r => r.status === 'completed');
    const pendingReservations = reservations.filter(r => r.status === 'pending').length;
    const avgRating = feedbackList.length > 0
        ? (feedbackList.reduce((s, f) => s + (f.rating || 0), 0) / feedbackList.length).toFixed(1)
        : '0.0';
    const availableLabs = labs.filter(l => l.status === 'available').length;

    const totalMs = completedRecords.reduce((sum, r) => {
        if (r.startTime && r.endTime) return sum + (new Date(r.endTime) - new Date(r.startTime));
        return sum;
    }, 0);
    const totalHours = (totalMs / 3600000).toFixed(1);

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('ana-total-students', users.length);
    setEl('ana-active-sitins', currentSitIns.length);
    setEl('ana-completed-sitins', completedRecords.length);
    setEl('ana-pending-reservations', pendingReservations);
    setEl('ana-total-hours', totalHours + 'h');
    setEl('ana-available-labs', availableLabs + '/' + labs.length);
    setEl('ana-total-feedback', feedbackList.length);
    setEl('ana-avg-rating', avgRating);
}

// ============================================
// Admin Dashboard - Leaderboard
// ============================================

function loadDashboardLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;

    const searchTerm = (document.getElementById('leaderboard-search')?.value || '').toLowerCase();
    const sortBy = document.getElementById('leaderboard-sort')?.value || 'sessions';

    let leaderboard = buildLeaderboardEntries();

    if (searchTerm) {
        leaderboard = leaderboard.filter(e =>
            e.name.toLowerCase().includes(searchTerm) ||
            e.idNumber.toLowerCase().includes(searchTerm)
        );
    }

    leaderboard.sort((a, b) => sortBy === 'hours'
        ? b.totalMinutes - a.totalMinutes
        : b.sessions - a.sessions || b.totalMinutes - a.totalMinutes);
    leaderboard = leaderboard.slice(0, 10);

    if (leaderboard.length === 0) {
        listEl.innerHTML = '<p class="no-data-msg">No session data yet. Start approving sit-ins to see the leaderboard.</p>';
        return;
    }

    listEl.innerHTML = leaderboard.map((entry, index) => {
        const rankClass = index === 0 ? 'lb-rank-1' : index === 1 ? 'lb-rank-2' : index === 2 ? 'lb-rank-3' : '';
        const hours = Math.floor(entry.totalMinutes / 60);
        const mins = entry.totalMinutes % 60;
        const durationStr = entry.totalMinutes > 0 ? (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`) : '—';
        return `<div class="lb-entry ${rankClass}">
            <span class="lb-rank">#${index + 1}</span>
            <div class="lb-info">
                <span class="lb-name">${escapeHTML(entry.name)}</span>
                <span class="lb-course">${escapeHTML(entry.course)} &bull; ID: ${escapeHTML(entry.idNumber)}</span>
            </div>
            <div class="lb-stats">
                <span class="lb-sessions">${entry.sessions} session${entry.sessions !== 1 ? 's' : ''}</span>
                <span class="lb-duration">${durationStr}</span>
            </div>
        </div>`;
    }).join('');
}

function buildLeaderboardEntries() {
    const records = getSitInRecords();
    const users = getUsers();
    const sessionCounts = {};
    const sessionDurations = {};

    records.forEach(r => {
        if (!r.idNumber) return;
        sessionCounts[r.idNumber] = (sessionCounts[r.idNumber] || 0) + 1;
        if (r.startTime && r.endTime) {
            const dur = new Date(r.endTime) - new Date(r.startTime);
            if (!isNaN(dur) && dur > 0) {
                sessionDurations[r.idNumber] = (sessionDurations[r.idNumber] || 0) + dur;
            }
        }
    });

    return Object.keys(sessionCounts).map(id => {
        const user = users.find(u => u.idNumber === id);
        return {
            idNumber: id,
            name: user ? `${user.firstName} ${user.lastName}` : id,
            course: user?.course || 'N/A',
            sessions: sessionCounts[id],
            totalMinutes: Math.floor((sessionDurations[id] || 0) / 60000)
        };
    }).sort((a, b) => {
        if (b.sessions !== a.sessions) return b.sessions - a.sessions;
        return b.totalMinutes - a.totalMinutes;
    });
}

function formatLeaderboardDuration(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (totalMinutes <= 0) return 'No time yet';
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function loadLandingLeaderboard(currentUserId) {
    const listEl = document.getElementById('landing-leaderboard-list');
    if (!listEl) return;

    const leaderboard = buildLeaderboardEntries();

    if (leaderboard.length === 0) {
        listEl.innerHTML = '<p class="no-data-msg">No sit-in sessions recorded yet.</p>';
        return;
    }

    listEl.innerHTML = leaderboard.slice(0, 8).map((entry, index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `landing-lb-rank-${rank}` : '';
        const currentClass = entry.idNumber === currentUserId ? ' is-current-user' : '';
        const durationStr = formatLeaderboardDuration(entry.totalMinutes);

        return `<div class="landing-lb-entry ${rankClass}${currentClass}">
            <span class="landing-lb-rank">${rank}</span>
            <div class="landing-lb-info">
                <span class="landing-lb-name">${escapeHTML(entry.name)}</span>
                <span class="landing-lb-meta">${escapeHTML(entry.course)} &bull; ${escapeHTML(entry.idNumber)}</span>
            </div>
            <div class="landing-lb-score">
                <span class="landing-lb-sessions">${entry.sessions}</span>
                <span class="landing-lb-duration">${durationStr}</span>
            </div>
        </div>`;
    }).join('');
}

// Load announcements for users on landing page
function loadUserAnnouncements() {
    const announcementsPlaceholder = document.querySelector('.announcements-placeholder');
    if (!announcementsPlaceholder) return;

    const announcements = getAnnouncements();

    if (announcements.length === 0) {
        announcementsPlaceholder.innerHTML = '<p>To request a sit-in, please contact the CCS Admin. Provide your student ID number and purpose for using the lab.</p>';
    } else {
        // Show latest announcement to users
        const latestAnnouncement = announcements[0];
        announcementsPlaceholder.innerHTML = `
            <div class="user-announcement">
                <p class="announcement-date">${new Date(latestAnnouncement.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                <p class="announcement-text">${escapeHTML(latestAnnouncement.text)}</p>
            </div>
        `;
    }
}

async function syncStudentsFromSupabase() {
    const client = getSupabaseClient();
    if (!client) return;

    const { data: students, error } = await client.from('students').select('*');
    if (error || !students || students.length === 0) return;

    const mapped = students.map(dbStudentToUser);
    saveUsers(mapped);
    return mapped;
}

async function initAdminStudents() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    // Initialize admin dropdowns
    initAdminDropdowns();

    await syncStudentsFromSupabase();
    loadStudentsTable();
    populateManualSitInLabSelect();

    // Add student button
    const addBtn = document.getElementById('add-student-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openStudentModal());
    }

    // Modal handlers
    const modalClose = document.getElementById('modal-close');
    const modalCancel = document.getElementById('modal-cancel');
    const studentModal = document.getElementById('student-modal');

    if (modalClose) modalClose.addEventListener('click', () => studentModal.style.display = 'none');
    if (modalCancel) modalCancel.addEventListener('click', () => studentModal.style.display = 'none');

    // Search modal handlers
    const searchNav = document.getElementById('nav-search');
    const searchModal = document.getElementById('search-modal');
    const searchModalClose = document.getElementById('search-modal-close');
    const searchForm = document.getElementById('search-form');

    if (searchNav && searchModal) {
        searchNav.addEventListener('click', function(e) {
            e.preventDefault();
            searchModal.style.display = 'flex';
        });
    }

    if (searchModalClose && searchModal) {
        searchModalClose.addEventListener('click', () => {
            searchModal.style.display = 'none';
            document.getElementById('search-input').value = '';
            document.getElementById('search-results').innerHTML = '';
        });
    }

    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const searchTerm = document.getElementById('search-input').value.trim();
            if (!searchTerm) return;

            const users = getUsers();
            const results = users.filter(u =>
                u.idNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (u.firstName + ' ' + u.lastName).toLowerCase().includes(searchTerm.toLowerCase())
            );

            const resultsDiv = document.getElementById('search-results');
            if (resultsDiv) {
                if (results.length === 0) {
                    resultsDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No students found.</p>';
                } else {
                    resultsDiv.innerHTML = results.map(u => `
                        <div style="padding: 0.75rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong>${u.firstName} ${u.lastName}</strong><br>
                                <small style="color: var(--text-muted);">${u.idNumber} | ${u.course}</small>
                            </div>
                            <a href="adminstudents.html" style="color: var(--primary-blue); text-decoration: none; font-size: 0.85rem;">View</a>
                        </div>
                    `).join('');
                }
            }
        });
    }

    if (searchModal) {
        searchModal.addEventListener('click', function(e) {
            if (e.target === searchModal) {
                searchModal.style.display = 'none';
                document.getElementById('search-input').value = '';
                document.getElementById('search-results').innerHTML = '';
            }
        });
    }

    // Student form submit
    const studentForm = document.getElementById('student-form');
    if (studentForm) {
        studentForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const editId = document.getElementById('edit-student-id').value;
            const email = document.getElementById('modal-email').value.trim();
            const password = document.getElementById('modal-password').value;
            const confirmPassword = document.getElementById('modal-confirm-password').value;
            const studentData = {
                idNumber: document.getElementById('modal-id-number').value.trim(),
                lastName: document.getElementById('modal-last-name').value.trim(),
                firstName: document.getElementById('modal-first-name').value.trim(),
                middleName: document.getElementById('modal-middle-name').value.trim(),
                email,
                course: document.getElementById('modal-course').value,
                courseLevel: document.getElementById('modal-level').value,
                address: document.getElementById('modal-address').value.trim(),
                remainingSessions: parseInt(document.getElementById('modal-sessions').value) || 30
            };

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showMessage('Please enter a valid email address.', 'error');
                return;
            }

            if (!editId && !password) {
                showMessage('Please enter a password for the student.', 'error');
                return;
            }

            if (password || confirmPassword) {
                if (password !== confirmPassword) {
                    showMessage('Passwords do not match. Please try again.', 'error');
                    return;
                }

                if (password.length < 6) {
                    showMessage('Password must be at least 6 characters long.', 'error');
                    return;
                }

                studentData.password = password;
            }

            let result;
            if (editId) {
                result = await updateStudent(editId, studentData);
            } else {
                result = await addStudent(studentData);
            }

            if (result.success) {
                studentModal.style.display = 'none';
                await loadStudentsTable();
                showMessage(result.message, 'success');
            } else {
                showMessage(result.message, 'error');
            }
        });
    }

    // Search - now also handles sit-in request display
    const studentSearch = document.getElementById('student-search');
    if (studentSearch) {
        studentSearch.addEventListener('input', function() {
            const searchTerm = this.value.trim();
            loadStudentsTable(searchTerm);
            // If search term looks like an ID number, show sit-in request section
            if (searchTerm.length >= 3) {
                searchStudentForSitInStudentsPage(searchTerm);
            } else {
                hideSitInRequestSection();
            }
        });
    }

    // Entries per page
    const entriesSelect = document.getElementById('entries-per-page');
    if (entriesSelect) {
        entriesSelect.addEventListener('change', () => loadStudentsTable());
    }

    // Approve reservation button (students page)
    const approveBtn = document.getElementById('approve-request-btn');
    if (approveBtn) {
        approveBtn.addEventListener('click', function() {
            const reservationId = parseInt(this.dataset.reservationId);
            const labSelect = document.getElementById('request-lab-select');
            const selectedLab = labSelect?.value;

            if (!selectedLab) {
                showMessage('Please assign a lab before approving.', 'error');
                return;
            }

            const admin = getCurrentAdmin();
            const result = approveReservation(reservationId, admin?.name || 'Admin', { lab: selectedLab });
            if (result.success) {
                showMessage(result.message || 'Reservation approved!', 'success');
                const idNumber = document.getElementById('sitin-result-id-number')?.textContent;
                if (idNumber) searchStudentForSitInStudentsPage(idNumber);
                loadStudentsTable();
            } else {
                showMessage(result.message, 'error');
            }
        });
    }

    // Reject reservation button (students page)
    const rejectBtn = document.getElementById('reject-request-btn');
    if (rejectBtn) {
        rejectBtn.addEventListener('click', function() {
            const reservationId = parseInt(this.dataset.reservationId);
            const reason = prompt('Enter rejection reason (optional):');
            if (reason !== null) {
                const admin = getCurrentAdmin();
                const result = rejectReservation(reservationId, admin?.name || 'Admin', reason || '');
                if (result.success) {
                    showMessage('Reservation rejected.', 'info');
                    const idNumber = document.getElementById('sitin-result-id-number')?.textContent;
                    if (idNumber) searchStudentForSitInStudentsPage(idNumber);
                } else {
                    showMessage(result.message, 'error');
                }
            }
        });
    }

    // Logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }
}

async function loadStudentsTable(searchTerm = '') {
    const tbody = document.getElementById('students-table-body');
    if (!tbody) return;

    const synced = await syncStudentsFromSupabase();
    let users = synced || getUsers();

    // Filter by search term
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        users = users.filter(u => 
            u.idNumber.toLowerCase().includes(term) ||
            u.firstName.toLowerCase().includes(term) ||
            u.lastName.toLowerCase().includes(term) ||
            (u.firstName + ' ' + u.lastName).toLowerCase().includes(term)
        );
    }

    // Pagination
    const entriesPerPage = parseInt(document.getElementById('entries-per-page')?.value) || 10;
    const totalPages = Math.ceil(users.length / entriesPerPage);
    const currentPageEl = document.getElementById('students-current-page');
    let currentPage = parseInt(currentPageEl?.dataset.page || '1');
    if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
    const start = (currentPage - 1) * entriesPerPage;
    const paginatedUsers = users.slice(start, start + entriesPerPage);

    tbody.innerHTML = paginatedUsers.map(u => `
        <tr>
            <td>${u.idNumber}</td>
            <td>${u.lastName}, ${u.firstName} ${u.middleName || ''}</td>
            <td>${u.courseLevel}</td>
            <td>${u.course}</td>
            <td>${u.remainingSessions || 30}</td>
            <td class="actions-cell">
                <button class="btn-edit-student" data-id="${u.idNumber}">Edit</button>
                <button class="btn-delete-student" data-id="${u.idNumber}">Delete</button>
            </td>
        </tr>
    `).join('');

    // Add edit/delete handlers
    tbody.querySelectorAll('.btn-edit-student').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = this.dataset.id;
            const user = users.find(u => u.idNumber === id);
            if (user) openStudentModal(user);
        });
    });

    tbody.querySelectorAll('.btn-delete-student').forEach(btn => {
        btn.addEventListener('click', async function() {
            const id = this.dataset.id;
            if (confirm(`Delete student ${id}? This cannot be undone.`)) {
                const result = await deleteStudent(id);
                if (result.success) {
                    await loadStudentsTable(searchTerm);
                    showMessage(result.message || 'Student deleted!', 'success');
                } else {
                    showMessage(result.message, 'error');
                }
            }
        });
    });

    // Pagination for students
    const studPaginationEl = document.getElementById('students-pagination');
    if (studPaginationEl) {
        const total = users.length;
        const showFrom = total === 0 ? 0 : start + 1;
        const showTo = Math.min(start + entriesPerPage, total);
        let html = `<div class="pagination-info">Showing ${showFrom}–${showTo} of ${total}</div><div class="pagination-btns" id="students-current-page" data-page="${currentPage}">`;
        for (let i = 1; i <= totalPages; i++) {
            html += `<button class="page-btn ${i === currentPage ? 'page-btn-active' : ''}" data-page="${i}">${i}</button>`;
        }
        html += '</div>';
        studPaginationEl.innerHTML = html;
        studPaginationEl.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const cpEl = document.getElementById('students-current-page');
                if (cpEl) cpEl.dataset.page = this.dataset.page;
                const term = document.getElementById('student-search')?.value || '';
                loadStudentsTable(term);
            });
        });
    }
}

function openStudentModal(student = null) {
    const modal = document.getElementById('student-modal');
    const title = document.getElementById('modal-title');
    
    if (student) {
        title.textContent = 'Edit Student';
        document.getElementById('edit-student-id').value = student.idNumber;
        document.getElementById('modal-id-number').value = student.idNumber;
        document.getElementById('modal-last-name').value = student.lastName;
        document.getElementById('modal-first-name').value = student.firstName;
        document.getElementById('modal-middle-name').value = student.middleName || '';
        document.getElementById('modal-email').value = student.email || '';
        document.getElementById('modal-address').value = student.address || '';
        document.getElementById('modal-password').value = '';
        document.getElementById('modal-confirm-password').value = '';
        document.getElementById('modal-password').placeholder = 'Leave blank to keep current password';
        document.getElementById('modal-confirm-password').placeholder = 'Leave blank to keep current password';
        document.getElementById('modal-course').value = student.course;
        document.getElementById('modal-level').value = student.courseLevel;
        document.getElementById('modal-sessions').value = student.remainingSessions || 30;
        document.getElementById('modal-id-number').disabled = true;
    } else {
        title.textContent = 'Add Student';
        document.getElementById('edit-student-id').value = '';
        document.getElementById('modal-id-number').disabled = false;
        document.getElementById('student-form').reset();
        document.getElementById('modal-password').placeholder = 'Enter password';
        document.getElementById('modal-confirm-password').placeholder = 'Re-enter password';
        document.getElementById('modal-sessions').value = 30;
    }

    modal.style.display = 'flex';
}

function initAdminSitIn() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    // Load current sit-ins table
    loadSitInTable();

    // Search functionality
    const searchBtn = document.getElementById('admin-search-btn');
    const searchInput = document.getElementById('admin-sitin-search');

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', function() {
            const idNumber = searchInput.value.trim();
            if (!idNumber) {
                showMessage('Please enter a student ID number.', 'error');
                return;
            }
            searchStudentForSitIn(idNumber);
        });

        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const idNumber = searchInput.value.trim();
                if (!idNumber) {
                    showMessage('Please enter a student ID number.', 'error');
                    return;
                }
                searchStudentForSitIn(idNumber);
            }
        });
    }

    // Approve request button
    const approveBtn = document.getElementById('approve-request-btn');
    if (approveBtn) {
        approveBtn.addEventListener('click', function() {
            const requestId = parseInt(this.dataset.requestId);
            const labSelect = document.getElementById('request-lab-select');
            const selectedLab = labSelect?.value;

            if (!selectedLab) {
                showMessage('Please assign a lab before approving.', 'error');
                return;
            }

            // Update the request with the assigned lab before approving
            const requests = getSitinRequests();
            const requestIndex = requests.findIndex(r => r.id === requestId);
            if (requestIndex !== -1) {
                requests[requestIndex].lab = selectedLab;
                saveSitInRequests(requests);
            }

            const result = approveSitInRequest(requestId);
            if (result.success) {
                showMessage(result.message, 'success');
                // Refresh the display
                const idNumber = document.getElementById('result-id-number')?.textContent;
                if (idNumber) searchStudentForSitIn(idNumber);
                loadSitInTable();
            } else {
                showMessage(result.message, 'error');
            }
        });
    }

    // Reject request button
    const rejectBtn = document.getElementById('reject-request-btn');
    if (rejectBtn) {
        rejectBtn.addEventListener('click', function() {
            const requestId = parseInt(this.dataset.requestId);
            const result = rejectSitInRequest(requestId);
            if (result.success) {
                showMessage(result.message, 'success');
                // Refresh the display
                const idNumber = document.getElementById('result-id-number')?.textContent;
                if (idNumber) searchStudentForSitIn(idNumber);
            } else {
                showMessage(result.message, 'error');
            }
        });
    }

    // Add sit-in button (walk-in approval)
    const addBtn = document.getElementById('add-sitin-btn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            const idNumber = document.getElementById('result-id-number')?.textContent;
            const labSelect = document.getElementById('manual-sitin-lab');
            const purposeInput = document.getElementById('manual-sitin-purpose');
            const pcNoInput = document.getElementById('manual-sitin-pcno');
            const selectedLab = labSelect?.value;
            const purpose = purposeInput?.value.trim();
            const pcNumber = pcNoInput?.value ? parseInt(pcNoInput.value, 10) : null;

            if (!idNumber) {
                showMessage('Please search for a student first.', 'error');
                return;
            }
            if (!selectedLab) {
                showMessage('Please select a lab.', 'error');
                return;
            }
            if (!purpose) {
                showMessage('Please enter a purpose.', 'error');
                return;
            }

            const user = getUsers().find(u => u.idNumber === idNumber);
            if (!user) {
                showMessage('Student not found.', 'error');
                return;
            }

            const sitInData = {
                id: Date.now(),
                sitIdNumber: 'SIT-' + Date.now().toString().slice(-6),
                idNumber: idNumber,
                name: `${user.firstName} ${user.lastName}`,
                purpose: purpose,
                lab: selectedLab,
                pcNumber: pcNumber,
                session: 1,
                status: 'active',
                startTime: new Date().toISOString()
            };

            addSitIn(sitInData);

            // Clear form
            if (purposeInput) purposeInput.value = '';
            if (labSelect) labSelect.value = '';
            if (pcNoInput) pcNoInput.value = '';
            
            // Refresh displays
            loadSitInTable();
            searchStudentForSitIn(idNumber);
            
            showMessage('✓ Sit-in approved! Student can now use the lab.', 'success');
        });
    }

    // Search modal handlers
    setupAdminSearchModal();

    // Logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }
}

function searchStudentForSitIn(idNumber) {
    const users = getUsers();
    const user = users.find(u => u.idNumber === idNumber);

    const resultSection = document.getElementById('admin-sitin-result-section');
    const noPendingMsg = document.getElementById('no-pending-message');

    if (!user) {
        showMessage('Student not found.', 'error');
        if (resultSection) resultSection.style.display = 'none';
        return;
    }

    // Show result section
    if (resultSection) resultSection.style.display = 'block';

    // Populate student info
    document.getElementById('result-id-number').textContent = user.idNumber;
    document.getElementById('result-name').textContent = `${user.firstName} ${user.lastName}`;
    document.getElementById('result-course').textContent = `${user.course} - ${user.courseLevel}${getYearSuffix(user.courseLevel)} Year`;
    document.getElementById('result-sessions').textContent = `${user.remainingSessions || 30} / 30`;

    // Check if student already has active session
    const currentSitIns = getCurrentSitIns();
    const hasActiveSession = currentSitIns.some(s => s.idNumber === idNumber && s.status === 'active');
    
    if (hasActiveSession) {
        showMessage('Student already has an active session. Please check them out first.', 'error');
        if (noPendingMsg) {
            noPendingMsg.style.display = 'block';
            noPendingMsg.innerHTML = '<p>Student already has an active session.</p>';
        }
        return;
    }

    // Check remaining sessions
    if (user.remainingSessions <= 0) {
        showMessage('Student has no remaining sessions.', 'error');
        if (noPendingMsg) {
            noPendingMsg.style.display = 'block';
            noPendingMsg.innerHTML = '<p>Student has no remaining sessions.</p>';
        }
        return;
    }

    // Populate lab dropdown for walk-in
    populateAdminLabSelect();
}

function populateLabSelectForRequest() {
    const labSelect = document.getElementById('request-lab-select');
    if (!labSelect) return;

    const labs = getLabRooms();
    const availableLabs = labs.filter(lab => lab.status !== 'maintenance' && lab.currentOccupancy < lab.capacity);

    if (availableLabs.length === 0) {
        labSelect.innerHTML = '<option value="">-- No Labs Available --</option>';
        return;
    }

    availableLabs.sort((a, b) => a.name.localeCompare(b.name));

    labSelect.innerHTML = '<option value="">-- Select Lab --</option>' +
        availableLabs.map(lab => {
            const availableSeats = lab.capacity - lab.currentOccupancy;
            return `<option value="${lab.name}">${lab.name} (${availableSeats} seats available)</option>`;
        }).join('');
}

function populateAdminLabSelect() {
    const labSelect = document.getElementById('manual-sitin-lab');
    if (!labSelect) return;

    const labs = getLabRooms();
    const availableLabs = labs.filter(lab => lab.status !== 'maintenance' && lab.currentOccupancy < lab.capacity);

    if (availableLabs.length === 0) {
        labSelect.innerHTML = '<option value="">-- No Labs Available --</option>';
        return;
    }

    availableLabs.sort((a, b) => a.name.localeCompare(b.name));

    labSelect.innerHTML = '<option value="">-- Select Lab --</option>' +
        availableLabs.map(lab => {
            const availableSeats = lab.capacity - lab.currentOccupancy;
            return `<option value="${lab.name}">${lab.name} (${availableSeats} seats available)</option>`;
        }).join('');
}

// ============================================
// Students Page Sit-in Request Functions
// ============================================

function searchStudentForSitInStudentsPage(idNumber) {
    const users = getUsers();
    // Find exact match or partial match
    const user = users.find(u => u.idNumber === idNumber) ||
                 users.find(u => u.idNumber.toLowerCase().includes(idNumber.toLowerCase()));

    const resultSection = document.getElementById('sitin-request-section');
    const pendingPanel = document.getElementById('pending-request-panel');
    const noPendingMsg = document.getElementById('no-pending-message');

    if (!user) {
        hideSitInRequestSection();
        return;
    }

    // Show result section
    if (resultSection) resultSection.style.display = 'block';

    // Populate student info
    document.getElementById('sitin-result-id-number').textContent = user.idNumber;
    document.getElementById('sitin-result-name').textContent = `${user.firstName} ${user.lastName}`;
    document.getElementById('sitin-result-course').textContent = `${user.course} - ${user.courseLevel}${getYearSuffix(user.courseLevel)} Year`;
    document.getElementById('sitin-result-sessions').textContent = `${user.remainingSessions || 30} / 30`;

    // Check for pending reservations
    const reservations = getReservations();
    const pendingReservation = reservations.find(r => r.studentId === user.idNumber && r.status === 'pending');

    if (pendingReservation) {
        // Show pending reservation panel
        if (pendingPanel) pendingPanel.style.display = 'block';
        if (noPendingMsg) noPendingMsg.style.display = 'none';

        // Populate reservation info
        document.getElementById('request-id').textContent = pendingReservation.reservationId || 'RES-' + pendingReservation.id;
        document.getElementById('request-purpose').textContent = pendingReservation.purpose || 'N/A';
        document.getElementById('request-time').textContent = new Date(pendingReservation.createdAt).toLocaleString();

        // Store reservation ID in buttons
        const approveBtn = document.getElementById('approve-request-btn');
        const rejectBtn = document.getElementById('reject-request-btn');
        if (approveBtn) approveBtn.dataset.reservationId = pendingReservation.id;
        if (rejectBtn) rejectBtn.dataset.reservationId = pendingReservation.id;

        // Populate lab dropdown
        populateLabSelectForRequestStudentsPage();
    } else {
        // No pending reservation
        if (pendingPanel) pendingPanel.style.display = 'none';
        if (noPendingMsg) noPendingMsg.style.display = 'block';
    }
}

function hideSitInRequestSection() {
    const resultSection = document.getElementById('sitin-request-section');
    if (resultSection) resultSection.style.display = 'none';
}

function populateLabSelectForRequestStudentsPage() {
    const labSelect = document.getElementById('request-lab-select');
    if (!labSelect) return;

    const labs = getLabRooms();
    const availableLabs = labs.filter(lab => lab.status !== 'maintenance' && lab.currentOccupancy < lab.capacity);

    if (availableLabs.length === 0) {
        labSelect.innerHTML = '<option value="">-- No Labs Available --</option>';
        return;
    }

    availableLabs.sort((a, b) => a.name.localeCompare(b.name));

    labSelect.innerHTML = '<option value="">-- Select Lab --</option>' +
        availableLabs.map(lab => {
            const availableSeats = lab.capacity - lab.currentOccupancy;
            return `<option value="${lab.name}">${lab.name} (${availableSeats} seats available)</option>`;
        }).join('');
}

function populateManualSitInLabSelect() {
    const labSelect = document.getElementById('manual-sitin-lab');
    if (!labSelect) return;

    const labs = getLabRooms();
    const availableLabs = labs.filter(lab => lab.status !== 'maintenance' && lab.currentOccupancy < lab.capacity);

    if (availableLabs.length === 0) {
        labSelect.innerHTML = '<option value="">-- No Labs Available --</option>';
        return;
    }

    availableLabs.sort((a, b) => a.name.localeCompare(b.name));

    labSelect.innerHTML = '<option value="">-- Select Lab --</option>' +
        availableLabs.map(lab => {
            const availableSeats = lab.capacity - lab.currentOccupancy;
            return `<option value="${lab.name}">${lab.name} (${availableSeats} seats available)</option>`;
        }).join('');
}

// ============================================
// Admin Records Page Functions
// ============================================

function initAdminRecords() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    // Initialize admin dropdowns
    initAdminDropdowns();

    loadRecordsTable();

    // Search modal handlers
    setupAdminSearchModal();

    // Export button
    const exportBtn = document.getElementById('export-records-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            exportRecordsToPDF();
        });
    }

    // Clear records button
    const clearBtn = document.getElementById('clear-records-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (confirm('Are you sure you want to clear ALL sit-in records? This cannot be undone.')) {
                saveSitInRecords([]);
                saveCurrentSitIns([]);
                updateLabOccupancy();
                loadRecordsTable();
                showMessage('All records cleared!', 'success');
            }
        });
    }

    // Search
    const searchInput = document.getElementById('records-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            loadRecordsTable(this.value);
        });
    }

    // Entries per page
    const entriesSelect = document.getElementById('records-entries-per-page');
    if (entriesSelect) {
        entriesSelect.addEventListener('change', () => loadRecordsTable());
    }

    // Logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }
}

function loadPendingRequests() {
    const tbody = document.getElementById('requests-table-body');
    const noRequests = document.getElementById('no-requests');
    if (!tbody) return;

    const requests = getSitinRequests();
    const labs = getLabRooms();
    const availableLabs = labs.filter(lab => lab.status !== 'maintenance' && lab.currentOccupancy < lab.capacity);

    if (requests.length === 0) {
        tbody.innerHTML = '';
        if (noRequests) noRequests.style.display = 'block';
        return;
    }

    if (noRequests) noRequests.style.display = 'none';

    // Generate lab options HTML
    const labOptions = '<option value="">-- Select Lab --</option>' +
        availableLabs.map(lab => {
            const availableSeats = lab.capacity - lab.currentOccupancy;
            return `<option value="${lab.name}">${lab.name} (${availableSeats} seats available)</option>`;
        }).join('');

    tbody.innerHTML = requests.map(r => `
        <tr>
            <td>${r.sitIdNumber || 'REQ-' + r.id}</td>
            <td>${r.idNumber}</td>
            <td>${r.name}</td>
            <td>${r.purpose || 'N/A'}</td>
            <td>${new Date(r.requestTime).toLocaleString()}</td>
            <td>
                <select class="lab-assignment-select" data-request-id="${r.id}">
                    ${labOptions}
                </select>
            </td>
            <td class="actions-cell">
                <button class="btn-approve-request" data-id="${r.id}">✓ Approve</button>
                <button class="btn-reject-request" data-id="${r.id}">✗ Reject</button>
            </td>
        </tr>
    `).join('');

    // Add approve/reject handlers
    tbody.querySelectorAll('.btn-approve-request').forEach(btn => {
        btn.addEventListener('click', function() {
            const requestId = parseInt(this.dataset.id);
            const labSelect = tbody.querySelector(`.lab-assignment-select[data-request-id="${requestId}"]`);
            const selectedLab = labSelect?.value;

            if (!selectedLab) {
                showMessage('Please assign a lab before approving.', 'error');
                return;
            }

            // Update the request with the assigned lab before approving
            const requests = getSitinRequests();
            const requestIndex = requests.findIndex(r => r.id === requestId);
            if (requestIndex !== -1) {
                requests[requestIndex].lab = selectedLab;
                saveSitInRequests(requests);
            }

            const result = approveSitInRequest(requestId);
            if (result.success) {
                showMessage(result.message, 'success');
                loadPendingRequests();
                loadRecordsTable();
            } else {
                showMessage(result.message, 'error');
            }
        });
    });

    tbody.querySelectorAll('.btn-reject-request').forEach(btn => {
        btn.addEventListener('click', function() {
            const requestId = parseInt(this.dataset.id);
            const result = rejectSitInRequest(requestId);
            if (result.success) {
                showMessage(result.message, 'success');
                loadPendingRequests();
            } else {
                showMessage(result.message, 'error');
            }
        });
    });
}

function loadRecordsTable(searchTerm = '') {
    const tbody = document.getElementById('records-table-body');
    if (!tbody) return;

    let records = getSitInRecords();

    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        records = records.filter(r =>
            r.idNumber.toLowerCase().includes(term) ||
            r.name.toLowerCase().includes(term) ||
            r.lab.toLowerCase().includes(term) ||
            r.sitIdNumber.toLowerCase().includes(term)
        );
    }

    // Sort by start time (newest first)
    records.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Pagination
    const entriesPerPage = parseInt(document.getElementById('records-entries-per-page')?.value) || 10;
    const totalPages = Math.ceil(records.length / entriesPerPage);
    const currentPageEl = document.getElementById('records-current-page');
    let currentPage = parseInt(currentPageEl?.dataset.page || '1');
    if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
    const start = (currentPage - 1) * entriesPerPage;
    const paginatedRecords = records.slice(start, start + entriesPerPage);

    tbody.innerHTML = paginatedRecords.map(r => `
        <tr>
            <td>${r.sitIdNumber || 'N/A'}</td>
            <td>${r.idNumber}</td>
            <td>${r.name}</td>
            <td>${r.lab}</td>
            <td>${r.purpose || 'N/A'}</td>
            <td>${new Date(r.startTime).toLocaleString()}</td>
            <td>${r.endTime ? new Date(r.endTime).toLocaleString() : 'Active'}</td>
            <td><span class="status-badge status-${r.status}">${r.status}</span></td>
        </tr>
    `).join('');

    // Update pagination
    const paginationEl = document.getElementById('records-pagination');
    if (paginationEl) {
        const totalEntries = records.length;
        const showFrom = totalEntries === 0 ? 0 : start + 1;
        const showTo = Math.min(start + entriesPerPage, totalEntries);
        let paginationHTML = `<div class="pagination-info">Showing ${showFrom}–${showTo} of ${totalEntries} records</div><div class="pagination-btns" id="records-current-page" data-page="${currentPage}">`;
        for (let i = 1; i <= totalPages; i++) {
            paginationHTML += `<button class="page-btn ${i === currentPage ? 'page-btn-active' : ''}" data-page="${i}">${i}</button>`;
        }
        paginationHTML += '</div>';
        paginationEl.innerHTML = paginationHTML;
        paginationEl.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const cpEl = document.getElementById('records-current-page');
                if (cpEl) cpEl.dataset.page = this.dataset.page;
                const searchTerm = document.getElementById('records-search')?.value || '';
                loadRecordsTable(searchTerm);
            });
        });
    }
}

function exportRecordsToPDF() {
    const records = getSitInRecords();
    if (records.length === 0) {
        showMessage('No records to export.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('CCS Sit-in Records', 14, 15);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);

    doc.autoTable({
        startY: 27,
        head: [['Sit ID', 'Student ID', 'Name', 'Lab', 'Purpose', 'Start Time', 'End Time', 'Status']],
        body: records.map(r => [
            r.sitIdNumber || 'N/A',
            r.idNumber,
            r.name,
            r.lab || 'N/A',
            r.purpose || 'N/A',
            new Date(r.startTime).toLocaleString(),
            r.endTime ? new Date(r.endTime).toLocaleString() : 'Active',
            r.status
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 90, 168] }
    });

    doc.save(`sitin-records-${new Date().toISOString().split('T')[0]}.pdf`);
    showMessage('Records exported as PDF!', 'success');
}

// ============================================
// Admin Reports Page Functions
// ============================================

function initAdminReports() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    loadReportsTable();

    // Export completed sessions button
    const exportCompletedBtn = document.getElementById('export-completed-btn');
    if (exportCompletedBtn) {
        exportCompletedBtn.addEventListener('click', function() {
            exportReportsToCSV('completed');
        });
    }

    // Export all records button
    const exportAllBtn = document.getElementById('export-all-btn');
    if (exportAllBtn) {
        exportAllBtn.addEventListener('click', function() {
            exportReportsToCSV('all');
        });
    }

    // Search
    const searchInput = document.getElementById('reports-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            loadReportsTable(this.value);
        });
    }

    // Entries per page
    const entriesSelect = document.getElementById('reports-entries-per-page');
    if (entriesSelect) {
        entriesSelect.addEventListener('change', () => loadReportsTable());
    }

    // Logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }
}

function loadReportsTable(searchTerm = '') {
    const tbody = document.getElementById('reports-table-body');
    if (!tbody) return;

    let records = getSitInRecords();

    // Filter by search term
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        records = records.filter(r =>
            r.idNumber.toLowerCase().includes(term) ||
            r.name.toLowerCase().includes(term) ||
            r.lab.toLowerCase().includes(term) ||
            r.sitIdNumber.toLowerCase().includes(term)
        );
    }

    // Sort by start time (newest first)
    records.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Pagination
    const entriesPerPage = parseInt(document.getElementById('reports-entries-per-page')?.value) || 10;
    const totalPages = Math.ceil(records.length / entriesPerPage);
    const currentPage = 1;
    const start = (currentPage - 1) * entriesPerPage;
    const paginatedRecords = records.slice(start, start + entriesPerPage);

    tbody.innerHTML = paginatedRecords.map(r => {
        const duration = r.endTime && r.startTime ? calculateDuration(r.startTime, r.endTime) : 'N/A';
        return `
        <tr>
            <td>${r.sitIdNumber || 'N/A'}</td>
            <td>${r.idNumber}</td>
            <td>${r.name}</td>
            <td>${r.lab || 'N/A'}</td>
            <td>${r.purpose || 'N/A'}</td>
            <td>${new Date(r.startTime).toLocaleString()}</td>
            <td>${r.endTime ? new Date(r.endTime).toLocaleString() : 'Active'}</td>
            <td>${duration}</td>
            <td><span class="status-badge status-${r.status}">${r.status}</span></td>
        </tr>
    `}).join('');

    // Update pagination
    const paginationEl = document.getElementById('reports-pagination');
    if (paginationEl) {
        const completedCount = records.filter(r => r.status === 'completed').length;
        paginationEl.innerHTML = `
            <p style="text-align: center; color: var(--text-muted); padding: 1rem;">
                Showing ${Math.min(paginatedRecords.length, records.length)} of ${records.length} records 
                (${completedCount} completed sessions)
            </p>
        `;
    }
}

function calculateDuration(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    
    if (diffHrs > 0) {
        return `${diffHrs}h ${diffMins}m`;
    }
    return `${diffMins}m`;
}

function exportReportsToCSV(type = 'all') {
    let records = getSitInRecords();
    
    if (type === 'completed') {
        records = records.filter(r => r.status === 'completed');
    }

    if (records.length === 0) {
        showMessage('No records to export.', 'error');
        return;
    }

    const headers = ['Sit ID', 'Student ID', 'Name', 'Lab', 'Purpose', 'Start Time', 'End Time', 'Duration', 'Status'];
    const csvContent = [
        headers.join(','),
        ...records.map(r => {
            const duration = r.endTime && r.startTime ? calculateDuration(r.startTime, r.endTime) : 'N/A';
            return [
                r.sitIdNumber || 'N/A',
                r.idNumber,
                `"${r.name}"`,
                r.lab || 'N/A',
                `"${r.purpose || 'N/A'}"`,
                new Date(r.startTime).toLocaleString(),
                r.endTime ? new Date(r.endTime).toLocaleString() : 'Active',
                duration,
                r.status
            ].join(',');
        })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `sitin-reports-${type}-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showMessage(`${type === 'completed' ? 'Completed sessions' : 'All records'} exported successfully!`, 'success');
}

function initAdminLabs() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    // Initialize admin dropdowns
    initAdminDropdowns();

    loadLabManagementGrid();
    updateLabStats();
    initSoftwareModal();

    // Modal handlers for lab status modal
    const modalClose = document.getElementById('lab-modal-close');
    const modalCancel = document.getElementById('lab-cancel');
    const labModal = document.getElementById('lab-status-modal');

    if (modalClose) modalClose.addEventListener('click', () => labModal.style.display = 'none');
    if (modalCancel) modalCancel.addEventListener('click', () => labModal.style.display = 'none');

    // Add Lab modal handlers
    const addLabBtn = document.getElementById('add-lab-btn');
    const addLabModalClose = document.getElementById('add-lab-modal-close');
    const addLabModalCancel = document.getElementById('add-lab-cancel');
    const addLabModal = document.getElementById('add-lab-modal');

    if (addLabBtn) {
        addLabBtn.addEventListener('click', () => {
            openAddLabModal();
        });
    }

    if (addLabModalClose) addLabModalClose.addEventListener('click', () => addLabModal.style.display = 'none');
    if (addLabModalCancel) addLabModalCancel.addEventListener('click', () => addLabModal.style.display = 'none');

    // Lab status form submit
    const labForm = document.getElementById('lab-status-form');
    if (labForm) {
        labForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const labId = document.getElementById('edit-lab-id').value;
            const newStatus = document.getElementById('lab-status-select').value;
            const newCapacity = parseInt(document.getElementById('lab-capacity').value);

            const labs = getLabRooms();
            const labIndex = labs.findIndex(l => l.id === labId);
            if (labIndex !== -1) {
                labs[labIndex].status = newStatus;
                labs[labIndex].capacity = newCapacity;
                saveLabRooms(labs);
                labModal.style.display = 'none';
                loadLabManagementGrid();
                updateLabStats();
                showMessage('Lab status updated!', 'success');
            }
        });
    }

    // Add Lab form submit
    const addLabForm = document.getElementById('add-lab-form');
    if (addLabForm) {
        addLabForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const editLabId = document.getElementById('add-edit-lab-id').value;
            const labName = document.getElementById('add-lab-name').value.trim();
            const labCapacity = parseInt(document.getElementById('add-lab-capacity').value);
            const labStatus = document.getElementById('add-lab-status').value;

            if (editLabId) {
                // Edit existing lab
                const labs = getLabRooms();
                const labIndex = labs.findIndex(l => l.id === editLabId);
                if (labIndex !== -1) {
                    labs[labIndex].name = labName;
                    labs[labIndex].capacity = labCapacity;
                    labs[labIndex].status = labStatus;
                    saveLabRooms(labs);
                    showMessage('Lab updated successfully!', 'success');
                }
            } else {
                // Add new lab
                const labId = 'lab-' + Date.now();
                const result = addLab({
                    id: labId,
                    name: labName,
                    capacity: labCapacity,
                    status: labStatus
                });
                if (result.success) {
                    showMessage('Lab added successfully!', 'success');
                }
            }

            addLabModal.style.display = 'none';
            loadLabManagementGrid();
            updateLabStats();
        });
    }

    // Search modal handlers
    setupAdminSearchModal();

    // Logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }
}

function loadLabManagementGrid() {
    const grid = document.getElementById('lab-management-grid');
    if (!grid) return;

    const labs = updateLabOccupancy();

    grid.innerHTML = labs.map(lab => {
        const software = lab.software || [];
        const softwareTags = software.length > 0
            ? software.map(s => `<span class="lab-software-tag">${escapeHTML(s)}</span>`).join('')
            : '<span style="font-size:0.78rem;opacity:0.5">No software listed</span>';
        return `
        <div class="lab-management-card ${lab.status}">
            <div class="lab-mgmt-header">
                <h4>${lab.name}</h4>
                <span class="lab-mgmt-status ${lab.status}-status">${lab.status}</span>
            </div>
            <div class="lab-mgmt-info">
                <p><strong>Capacity:</strong> ${lab.capacity}</p>
                <p><strong>Current:</strong> ${lab.currentOccupancy} students</p>
                <p><strong>Available Seats:</strong> ${lab.capacity - lab.currentOccupancy}</p>
            </div>
            <div class="lab-software-tags">${softwareTags}</div>
            <div class="lab-mgmt-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${(lab.currentOccupancy / lab.capacity) * 100}%"></div>
                </div>
            </div>
            <div class="lab-mgmt-actions">
                <button class="btn lab-software-btn" data-lab-id="${lab.id}">Software</button>
                <button class="btn lab-edit-btn" data-lab-id="${lab.id}">Edit</button>
                <button class="btn lab-delete-btn" data-lab-id="${lab.id}">Delete</button>
            </div>
        </div>
    `}).join('');

    // Software button handlers
    grid.querySelectorAll('.lab-software-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            openSoftwareModal(this.dataset.labId);
        });
    });

    // Add edit button handlers
    grid.querySelectorAll('.lab-edit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const labId = this.dataset.labId;
            const lab = getLabRooms().find(l => l.id === labId);
            if (lab) {
                openAddLabModal(lab);
            }
        });
    });

    // Add delete button handlers
    grid.querySelectorAll('.lab-delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const labId = this.dataset.labId;
            const lab = getLabRooms().find(l => l.id === labId);
            if (confirm(`Delete ${lab.name}? This cannot be undone.`)) {
                deleteLab(labId);
                loadLabManagementGrid();
                updateLabStats();
                showMessage('Lab deleted successfully!', 'success');
            }
        });
    });
}

function openSoftwareModal(labId) {
    const lab = getLabRooms().find(l => l.id === labId);
    if (!lab) return;

    document.getElementById('software-lab-id').value = labId;
    document.getElementById('software-modal-title').textContent = `Software — ${lab.name}`;

    const saved = lab.software || [];

    // Reset checkboxes
    document.querySelectorAll('#software-checklist input[type="checkbox"]').forEach(cb => {
        cb.checked = saved.includes(cb.value);
    });

    // Show custom (non-preset) software as tags
    const presets = Array.from(document.querySelectorAll('#software-checklist input[type="checkbox"]')).map(cb => cb.value);
    const customList = document.getElementById('software-custom-list');
    customList.innerHTML = '';
    saved.filter(s => !presets.includes(s)).forEach(s => addCustomTag(s));

    document.getElementById('software-custom').value = '';
    document.getElementById('software-modal').style.display = 'flex';
}

function addCustomTag(name) {
    const list = document.getElementById('software-custom-list');
    const tag = document.createElement('span');
    tag.className = 'software-custom-tag';
    tag.dataset.name = name;
    tag.innerHTML = `${escapeHTML(name)} <button type="button" title="Remove">&times;</button>`;
    tag.querySelector('button').addEventListener('click', () => tag.remove());
    list.appendChild(tag);
}

function saveSoftware() {
    const labId = document.getElementById('software-lab-id').value;
    const labs = getLabRooms();
    const lab = labs.find(l => l.id === labId);
    if (!lab) return;

    const checked = Array.from(document.querySelectorAll('#software-checklist input[type="checkbox"]:checked')).map(cb => cb.value);
    const custom = Array.from(document.querySelectorAll('#software-custom-list .software-custom-tag')).map(t => t.dataset.name);

    lab.software = [...checked, ...custom];
    saveLabRooms(labs);

    document.getElementById('software-modal').style.display = 'none';
    loadLabManagementGrid();
    showMessage('Software updated!', 'success');
}

function initSoftwareModal() {
    const modal = document.getElementById('software-modal');
    if (!modal) return;

    document.getElementById('software-modal-close').onclick = () => modal.style.display = 'none';
    document.getElementById('software-cancel').onclick = () => modal.style.display = 'none';
    document.getElementById('software-save-btn').onclick = saveSoftware;
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    document.getElementById('software-add-custom-btn').addEventListener('click', () => {
        const input = document.getElementById('software-custom');
        const name = input.value.trim();
        if (!name) return;
        const presets = Array.from(document.querySelectorAll('#software-checklist input[type="checkbox"]')).map(cb => cb.value);
        const existing = Array.from(document.querySelectorAll('#software-custom-list .software-custom-tag')).map(t => t.dataset.name);
        if (presets.includes(name) || existing.includes(name)) {
            showMessage('Software already in the list.', 'error');
            return;
        }
        addCustomTag(name);
        input.value = '';
    });
}

function openLabStatusModal(labId) {
    const labs = getLabRooms();
    const lab = labs.find(l => l.id === labId);
    if (!lab) return;

    document.getElementById('edit-lab-id').value = lab.id;
    document.getElementById('lab-name-display').value = lab.name;
    document.getElementById('lab-status-select').value = lab.status;
    document.getElementById('lab-capacity').value = lab.capacity;

    const modal = document.getElementById('lab-status-modal');
    modal.style.display = 'flex';
}

function openAddLabModal(lab = null) {
    const modal = document.getElementById('add-lab-modal');
    const title = document.getElementById('add-lab-modal-title');
    const submitBtn = document.getElementById('add-lab-submit-btn');

    if (lab) {
        // Edit mode
        title.textContent = 'Edit Lab Room';
        submitBtn.textContent = 'Update Lab';
        document.getElementById('add-edit-lab-id').value = lab.id;
        document.getElementById('add-lab-name').value = lab.name;
        document.getElementById('add-lab-capacity').value = lab.capacity;
        document.getElementById('add-lab-status').value = lab.status;
    } else {
        // Add mode
        title.textContent = 'Add New Lab Room';
        submitBtn.textContent = 'Add Lab';
        document.getElementById('add-edit-lab-id').value = '';
        document.getElementById('add-lab-form').reset();
        document.getElementById('add-lab-capacity').value = 40;
    }

    modal.style.display = 'flex';
}

function updateLabStats() {
    const labs = updateLabOccupancy();
    const totalLabs = labs.length;
    const availableLabs = labs.filter(l => l.status === 'available').length;
    const maintenanceLabs = labs.filter(l => l.status === 'maintenance').length;
    const totalOccupancy = labs.reduce((sum, l) => sum + l.currentOccupancy, 0);

    const totalLabsEl = document.getElementById('total-labs');
    const availableLabsEl = document.getElementById('available-labs');
    const maintenanceLabsEl = document.getElementById('maintenance-labs');
    const totalOccupancyEl = document.getElementById('total-occupancy');

    if (totalLabsEl) totalLabsEl.textContent = totalLabs;
    if (availableLabsEl) availableLabsEl.textContent = availableLabs;
    if (maintenanceLabsEl) maintenanceLabsEl.textContent = maintenanceLabs;
    if (totalOccupancyEl) totalOccupancyEl.textContent = totalOccupancy;
}

function loadSitInTable(searchTerm = '') {
    const tbody = document.getElementById('sitin-table-body');
    if (!tbody) return;

    let sitIns = getCurrentSitIns();

    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        sitIns = sitIns.filter(s => 
            s.idNumber.toLowerCase().includes(term) ||
            s.name.toLowerCase().includes(term) ||
            s.sitIdNumber.toLowerCase().includes(term)
        );
    }

    tbody.innerHTML = sitIns.map(s => `
        <tr>
            <td>${s.sitIdNumber}</td>
            <td>${s.idNumber}</td>
            <td>${s.name}</td>
            <td>${s.purpose}</td>
            <td>${s.lab}</td>
            <td>${s.session}</td>
            <td><span class="status-badge status-${s.status}">${s.status}</span></td>
            <td class="actions-cell">
                <button class="btn-end-sitin" data-id="${s.id}">End</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.btn-end-sitin').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = parseInt(this.dataset.id);
            if (confirm('End this sit-in session?')) {
                removeSitIn(id);
                loadSitInTable();
                showMessage('Sit-in session ended!', 'info');
            }
        });
    });
}

function openSitInModal() {
    const modal = document.getElementById('sitin-modal');
    document.getElementById('sitin-form').reset();
    populateAdminLabSelect();
    modal.style.display = 'flex';
}

// ============================================
// Sit-in Page (Student) Functions
// ============================================

function initSitInPage() {
    const user = getCurrentUser();

    // Initialize lab rooms if not exists
    if (!localStorage.getItem(STORAGE_KEYS.LAB_ROOMS)) {
        saveLabRooms(getDefaultLabRooms());
    }

    // Check if user is logged in
    if (!user) {
        showMessage('Please log in to access sit-in facilities.', 'error');
        setTimeout(() => {
            window.location.href = 'loginpage.html';
        }, 2000);
        return;
    }

    // Auto-fill with logged-in user's information
    const idInput = document.getElementById('student-id-number');
    if (idInput) {
        idInput.value = user.idNumber;
        // Trigger the blur event to load user info
        setTimeout(() => {
            idInput.dispatchEvent(new Event('blur'));
        }, 100);
    }

    // Load student info
    loadStudentSitInInfo(user);

    // ID number lookup
    if (idInput) {
        idInput.addEventListener('blur', function() {
            const id = this.value.trim();
            const users = getUsers();
            const foundUser = users.find(u => u.idNumber === id);

            if (foundUser) {
                document.getElementById('display-name').textContent = `${foundUser.firstName} ${foundUser.lastName}`;
                document.getElementById('display-course').textContent = foundUser.course;
                document.getElementById('display-sessions').textContent = foundUser.remainingSessions || 30;
                document.getElementById('student-info-display').style.display = 'block';
            } else {
                document.getElementById('display-name').textContent = '';
                document.getElementById('display-course').textContent = '';
                document.getElementById('display-sessions').textContent = '';
                document.getElementById('student-info-display').style.display = 'none';
            }
        });
    }

    // Form submit - Request Sit-in
    const sitInForm = document.getElementById('sitin-student-form');
    if (sitInForm) {
        sitInForm.addEventListener('submit', function(e) {
            e.preventDefault();

            const idNumber = document.getElementById('student-id-number').value.trim();
            const purpose = document.getElementById('sitin-purpose').value;

            if (!idNumber || !purpose) {
                showMessage('Please fill in all fields.', 'error');
                return;
            }

            const users = getUsers();
            const foundUser = users.find(u => u.idNumber === idNumber);

            if (!foundUser) {
                showMessage('Student not found. Please check your ID number.', 'error');
                return;
            }

            if ((foundUser.remainingSessions || 30) <= 0) {
                showMessage('No remaining sessions available. Please contact admin.', 'error');
                return;
            }

            // Check if already has active session
            const existingSitIn = getStudentCurrentSitIn(idNumber);
            if (existingSitIn) {
                showMessage('You already have an active session. Please check out first.', 'error');
                return;
            }

            // Check if already has pending request
            const requests = getSitinRequests();
            const existingRequest = requests.find(r => r.idNumber === idNumber && r.status === 'pending');
            if (existingRequest) {
                showMessage('You already have a pending request. Please wait for admin approval.', 'error');
                return;
            }

            const sitInData = {
                sitIdNumber: 'REQ-' + Date.now().toString().slice(-6),
                idNumber: idNumber,
                name: `${foundUser.firstName} ${foundUser.lastName}`,
                purpose: purpose,
                lab: '', // Lab will be assigned by admin
                session: 1
            };

            const result = addSitInRequest(sitInData);
            if (result.success) {
                showMessage('Request submitted! Please wait for admin approval.', 'success');
                // Clear the form
                document.getElementById('sitin-purpose').value = '';
            }
        });
    }

    // Check Out button
    const checkoutBtn = document.getElementById('sitin-checkout-btn');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', function() {
            const idNumber = document.getElementById('student-id-number').value.trim();

            if (!idNumber) {
                showMessage('Please enter your ID number.', 'error');
                return;
            }

            const result = checkOutStudent(idNumber);
            if (result.success) {
                showMessage('Check-out successful! See you next time.', 'success');
                loadStudentSitInInfo(user);
            } else {
                showMessage('No active session found.', 'error');
            }
        });
    }

    // Load history
    loadSitInHistory();
}

function populateLabSelect() {
    const labSelect = document.getElementById('selected-lab');
    if (!labSelect) return;

    const labs = getLabRooms();

    // Filter to only show available labs (not in maintenance)
    const availableLabs = labs.filter(lab => lab.status !== 'maintenance');

    if (availableLabs.length === 0) {
        labSelect.innerHTML = '<option value="">-- No Labs Available --</option>';
        return;
    }

    // Sort labs by name for consistent order
    availableLabs.sort((a, b) => a.name.localeCompare(b.name));

    labSelect.innerHTML = '<option value="">-- Select a Lab --</option>' +
        availableLabs.map(lab => {
            const availableSeats = lab.capacity - lab.currentOccupancy;
            const statusLabel = availableSeats > 0 ? `${availableSeats}/${lab.capacity} seats` : 'Full';
            const disabled = availableSeats === 0 ? 'disabled' : '';
            return `<option value="${lab.name}" ${disabled}>${lab.name} - ${statusLabel}</option>`;
        }).join('');
}

function loadStudentSitInInfo(user) {
    const currentSitIn = getStudentCurrentSitIn(user.idNumber);
    const submitBtn = document.getElementById('sitin-submit-btn');
    const checkoutBtn = document.getElementById('sitin-checkout-btn');
    const currentSessionInfo = document.getElementById('current-session-info');
    const actionTitle = document.getElementById('sitin-action-title');
    
    if (currentSitIn) {
        // User has active session - show check-out mode
        if (actionTitle) actionTitle.textContent = 'Check Out';
        if (submitBtn) submitBtn.style.display = 'none';
        if (checkoutBtn) checkoutBtn.style.display = 'block';
        
        if (currentSessionInfo) {
            currentSessionInfo.style.display = 'block';
            document.getElementById('current-lab').textContent = currentSitIn.lab;
            document.getElementById('current-start-time').textContent = 
                new Date(currentSitIn.startTime).toLocaleString();
            document.getElementById('current-purpose').textContent = currentSitIn.purpose;
        }
    } else {
        // No active session - show check-in mode
        if (actionTitle) actionTitle.textContent = 'Check In';
        if (submitBtn) submitBtn.style.display = 'block';
        if (checkoutBtn) checkoutBtn.style.display = 'none';
        if (currentSessionInfo) currentSessionInfo.style.display = 'none';
    }
}

function loadSitInHistory() {
    const user = getCurrentUser();
    if (!user) return;

    const historyContainer = document.getElementById('sitin-history-container');
    if (!historyContainer) return;

    const history = getStudentHistory(user.idNumber);

    if (history.length === 0) {
        historyContainer.innerHTML = '<p class="no-history">No sit-in records yet.</p>';
        return;
    }

    historyContainer.innerHTML = history.map(record => `
        <div class="history-item">
            <div class="history-info">
                <div class="history-lab">${record.lab}</div>
                <div class="history-purpose">${record.purpose}</div>
                <div class="history-date">${new Date(record.startTime).toLocaleString()}</div>
            </div>
            <span class="history-status ${record.status}">${record.status}</span>
        </div>
    `).join('');
}

// ============================================
// Edit Profile Functions
// ============================================

function initEditProfilePage() {
    const user = getCurrentUser();

    // Check if user is logged in
    if (!user) {
        showMessage('Please log in to edit your profile.', 'error');
        setTimeout(() => {
            window.location.href = 'loginpage.html';
        }, 2000);
        return;
    }

    // Load user data into form
    loadUserProfile(user);

    // Form submit handler
    const form = document.getElementById('edit-profile-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveUserProfile(user);
        });
    }

    // Profile photo upload handler
    const photoUpload = document.getElementById('profile-photo-upload');
    const photoRemoveBtn = document.getElementById('photo-remove-btn');

    if (photoUpload) {
        photoUpload.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const photoData = event.target.result;
                    // Save to localStorage (note: localStorage has size limits)
                    const users = getUsers();
                    const userIndex = users.findIndex(u => u.idNumber === user.idNumber);
                    if (userIndex !== -1) {
                        users[userIndex].profilePhoto = photoData;
                        saveUsers(users);
                        // Update preview
                        document.getElementById('profile-photo-preview').style.backgroundImage = `url(${photoData})`;
                        document.getElementById('profile-avatar-initials').style.display = 'none';
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (photoRemoveBtn) {
        photoRemoveBtn.addEventListener('click', function() {
            const users = getUsers();
            const userIndex = users.findIndex(u => u.idNumber === user.idNumber);
            if (userIndex !== -1) {
                users[userIndex].profilePhoto = null;
                saveUsers(users);
                document.getElementById('profile-photo-preview').style.backgroundImage = 'none';
                document.getElementById('profile-avatar-initials').style.display = 'flex';
                document.getElementById('profile-photo-upload').value = '';
            }
        });
    }
}

function loadUserProfile(user) {
    const users = getUsers();
    const currentUser = users.find(u => u.idNumber === user.idNumber);

    if (!currentUser) {
        showMessage('User not found.', 'error');
        return;
    }

    // Populate form fields
    const idInput = document.getElementById('edit-id-number');
    const lastNameInput = document.getElementById('edit-last-name');
    const firstNameInput = document.getElementById('edit-first-name');
    const middleNameInput = document.getElementById('edit-middle-name');
    const emailInput = document.getElementById('edit-email');
    const courseInput = document.getElementById('edit-course');
    const levelInput = document.getElementById('edit-course-level');
    const addressInput = document.getElementById('edit-address');
    const photoPreview = document.getElementById('profile-photo-preview');
    const avatarInitials = document.getElementById('profile-avatar-initials');

    if (idInput) idInput.value = currentUser.idNumber;
    if (lastNameInput) lastNameInput.value = currentUser.lastName || '';
    if (firstNameInput) firstNameInput.value = currentUser.firstName || '';
    if (middleNameInput) middleNameInput.value = currentUser.middleName || '';
    if (emailInput) emailInput.value = currentUser.email || '';
    if (courseInput) courseInput.value = currentUser.course || '';
    if (levelInput) levelInput.value = currentUser.courseLevel || '';
    if (addressInput) addressInput.value = currentUser.address || '';

    // Load profile photo
    if (currentUser.profilePhoto && photoPreview) {
        photoPreview.style.backgroundImage = `url(${currentUser.profilePhoto})`;
        if (avatarInitials) avatarInitials.style.display = 'none';
    }

    // Update profile dropdown
    updateNavForLoggedInUser();
}

function saveUserProfile(currentUser) {
    const users = getUsers();
    const userIndex = users.findIndex(u => u.idNumber === currentUser.idNumber);

    if (userIndex === -1) {
        showMessage('User not found.', 'error');
        return;
    }

    // Get form values
    const lastName = document.getElementById('edit-last-name')?.value.trim();
    const firstName = document.getElementById('edit-first-name')?.value.trim();
    const middleName = document.getElementById('edit-middle-name')?.value.trim();
    const email = document.getElementById('edit-email')?.value.trim();
    const course = document.getElementById('edit-course')?.value;
    const courseLevel = document.getElementById('edit-course-level')?.value;
    const address = document.getElementById('edit-address')?.value.trim();
    const newPassword = document.getElementById('edit-password')?.value;
    const confirmPassword = document.getElementById('edit-confirm-password')?.value;

    // Validation
    if (!lastName || !firstName || !email || !course || !courseLevel || !address) {
        showMessage('Please fill in all required fields.', 'error');
        return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showMessage('Please enter a valid email address.', 'error');
        return;
    }

    // Password validation (only if user entered a new password)
    if (newPassword) {
        if (newPassword.length < 6) {
            showMessage('Password must be at least 6 characters long.', 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage('Passwords do not match.', 'error');
            return;
        }
    }

    // Update user data
    users[userIndex].lastName = lastName;
    users[userIndex].firstName = firstName;
    users[userIndex].middleName = middleName;
    users[userIndex].email = email;
    users[userIndex].course = course;
    users[userIndex].courseLevel = courseLevel;
    users[userIndex].address = address;

    // Update password if provided
    if (newPassword) {
        users[userIndex].password = newPassword;
    }

    saveUsers(users);

    // Update current user session
    setCurrentUser({
        idNumber: users[userIndex].idNumber,
        firstName: users[userIndex].firstName,
        lastName: users[userIndex].lastName,
        course: users[userIndex].course,
        courseLevel: users[userIndex].courseLevel
    });

    showMessage('Profile updated successfully!', 'success');

    // Update navigation
    updateNavForLoggedInUser();

    // Redirect after short delay
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1500);
}

// ============================================
// Reservation Functions
// ============================================

function getDefaultReservations() {
    return [];
}

function getReservations() {
    const reservations = localStorage.getItem('ccs_reservations');
    return safeParseJSON(reservations, []);
}

function saveReservations(reservations) {
    localStorage.setItem('ccs_reservations', JSON.stringify(reservations));
}

function addReservation(reservationData) {
    const reservations = getReservations();
    const newReservation = {
        id: Date.now(),
        reservationId: 'RES-' + Date.now().toString().slice(-6),
        studentId: reservationData.studentId,
        studentName: reservationData.studentName,
        lab: reservationData.lab,
        date: reservationData.date,
        startTime: reservationData.startTime,
        endTime: reservationData.endTime,
        purpose: reservationData.purpose,
        notes: reservationData.notes || '',
        status: 'pending',
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null
    };
    reservations.unshift(newReservation);
    saveReservations(reservations);
    return { success: true, reservation: newReservation };
}

function updateReservation(id, updateData) {
    const reservations = getReservations();
    const index = reservations.findIndex(r => r.id === id);
    
    if (index === -1) {
        return { success: false, message: 'Reservation not found.' };
    }
    
    reservations[index] = { ...reservations[index], ...updateData };
    saveReservations(reservations);
    return { success: true, reservation: reservations[index] };
}

function deleteReservation(id) {
    const reservations = getReservations();
    const filtered = reservations.filter(r => r.id !== id);
    saveReservations(filtered);
    return { success: true };
}

function approveReservation(id, adminName, options = {}) {
    const reservations = getReservations();
    const reservation = reservations.find(r => r.id === id);
    if (!reservation) {
        return { success: false, message: 'Reservation not found.' };
    }
    if (reservation.status !== 'pending') {
        return { success: false, message: 'Only pending reservations can be approved.' };
    }

    const assignedLab = options.lab || reservation.lab;
    if (!assignedLab) {
        return { success: false, message: 'Please assign a lab before approving.' };
    }

    const user = getUsers().find(u => u.idNumber === reservation.studentId);
    if (user && (user.remainingSessions || 0) <= 0) {
        return { success: false, message: 'Student has no remaining sessions.' };
    }

    const updated = updateReservation(id, {
        status: 'approved',
        lab: assignedLab,
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminName
    });

    if (!updated.success) return updated;

    const existingActive = getStudentCurrentSitIn(reservation.studentId);
    if (existingActive) {
        return {
            success: true,
            reservation: updated.reservation,
            sitInStarted: false,
            message: 'Reservation approved, but student already has an active sit-in.'
        };
    }

    const sitInData = {
        id: Date.now(),
        sitIdNumber: 'SIT-' + Date.now().toString().slice(-6),
        idNumber: reservation.studentId,
        name: reservation.studentName || (user ? `${user.firstName} ${user.lastName}` : reservation.studentId),
        purpose: reservation.purpose || 'Reservation',
        lab: assignedLab,
        pcNumber: options.pcNumber || null,
        session: 1,
        status: 'active',
        startTime: new Date().toISOString(),
        reservationId: reservation.id
    };

    const sitInResult = addSitIn(sitInData);
    if (!sitInResult.success) {
        return { success: false, message: 'Reservation approved, but failed to start sit-in.' };
    }

    return {
        success: true,
        reservation: updated.reservation,
        sitInStarted: true,
        message: 'Reservation approved and sit-in started.'
    };
}

function rejectReservation(id, adminName, reason = '') {
    return updateReservation(id, {
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminName,
        rejectionReason: reason
    });
}

function getReservationStats() {
    const reservations = getReservations();
    return {
        total: reservations.length,
        pending: reservations.filter(r => r.status === 'pending').length,
        approved: reservations.filter(r => r.status === 'approved').length,
        rejected: reservations.filter(r => r.status === 'rejected').length,
        completed: reservations.filter(r => r.status === 'completed').length
    };
}

// ============================================
// Feedback Functions
// ============================================

function getDefaultFeedback() {
    return [];
}

function getFeedback() {
    const feedback = localStorage.getItem('ccs_feedback');
    return safeParseJSON(feedback, []);
}

function saveFeedback(feedback) {
    localStorage.setItem('ccs_feedback', JSON.stringify(feedback));
}

function addFeedback(feedbackData) {
    const feedbackList = getFeedback();
    const newFeedback = {
        id: Date.now(),
        feedbackId: 'FB-' + Date.now().toString().slice(-6),
        studentId: feedbackData.studentId,
        studentName: feedbackData.studentName,
        email: feedbackData.email || '',
        type: feedbackData.type || 'other',
        subject: feedbackData.subject || '',
        message: feedbackData.message,
        rating: feedbackData.rating || 0,
        status: 'pending',
        adminResponse: null,
        respondedAt: null,
        respondedBy: null,
        createdAt: new Date().toISOString()
    };
    feedbackList.unshift(newFeedback);
    saveFeedback(feedbackList);
    return { success: true, feedback: newFeedback };
}

function updateFeedback(id, updateData) {
    const feedbackList = getFeedback();
    const index = feedbackList.findIndex(f => f.id === id);
    
    if (index === -1) {
        return { success: false, message: 'Feedback not found.' };
    }
    
    feedbackList[index] = { ...feedbackList[index], ...updateData };
    saveFeedback(feedbackList);
    return { success: true, feedback: feedbackList[index] };
}

function deleteFeedback(id) {
    const feedbackList = getFeedback();
    const filtered = feedbackList.filter(f => f.id !== id);
    saveFeedback(filtered);
    return { success: true };
}

function resolveFeedback(id, adminName, response = '') {
    return updateFeedback(id, {
        status: 'resolved',
        adminResponse: response,
        respondedAt: new Date().toISOString(),
        respondedBy: adminName
    });
}

function getFeedbackStats() {
    const feedbackList = getFeedback();
    const total = feedbackList.length;
    const pending = feedbackList.filter(f => f.status === 'pending').length;
    const resolved = feedbackList.filter(f => f.status === 'resolved' || f.status === 'closed').length;
    
    // Calculate average rating
    const ratings = feedbackList.filter(f => f.rating > 0).map(f => f.rating);
    const avgRating = ratings.length > 0 
        ? (ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1)
        : '0.0';
    
    return {
        total,
        pending,
        resolved,
        avgRating
    };
}

// ============================================
// Admin Reservation Page Functions
// ============================================

function initAdminReservation() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    // Initialize admin dropdowns
    initAdminDropdowns();

    // Load reservation statistics
    loadReservationStats();

    // Load reservations table
    loadReservationsTable();

    // Populate lab dropdown
    populateReservationLabSelect();

    // Add reservation button
    const addBtn = document.getElementById('add-reservation-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openReservationModal());
    }

    // Modal handlers
    const modalClose = document.getElementById('reservation-modal-close');
    const modalCancel = document.getElementById('reservation-cancel');
    const reservationModal = document.getElementById('reservation-modal');

    if (modalClose) modalClose.addEventListener('click', () => reservationModal.style.display = 'none');
    if (modalCancel) modalCancel.addEventListener('click', () => reservationModal.style.display = 'none');

    // Student ID lookup
    const studentIdInput = document.getElementById('reservation-student-id');
    if (studentIdInput) {
        studentIdInput.addEventListener('blur', function() {
            const id = this.value.trim();
            if (id) {
                const user = getUsers().find(u => u.idNumber === id);
                const nameInput = document.getElementById('reservation-student-name');
                if (user && nameInput) {
                    nameInput.value = `${user.firstName} ${user.lastName}`;
                } else if (nameInput) {
                    nameInput.value = '';
                }
            }
        });
    }

    // Reservation form submit
    const reservationForm = document.getElementById('reservation-form');
    if (reservationForm) {
        reservationForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const editId = document.getElementById('edit-reservation-id').value;
            const reservationData = {
                studentId: document.getElementById('reservation-student-id').value.trim(),
                studentName: document.getElementById('reservation-student-name').value.trim(),
                lab: document.getElementById('reservation-lab').value,
                date: document.getElementById('reservation-date').value,
                startTime: document.getElementById('reservation-start-time').value,
                endTime: document.getElementById('reservation-end-time').value,
                purpose: document.getElementById('reservation-purpose').value.trim(),
                notes: document.getElementById('reservation-notes').value.trim()
            };

            // Validation
            if (!reservationData.studentId || !reservationData.lab || !reservationData.date) {
                showMessage('Please fill in all required fields.', 'error');
                return;
            }

            let result;
            if (editId) {
                result = updateReservation(parseInt(editId), reservationData);
            } else {
                result = addReservation(reservationData);
            }

            if (result.success) {
                reservationModal.style.display = 'none';
                loadReservationsTable();
                loadReservationStats();
                showMessage(editId ? 'Reservation updated successfully!' : 'Reservation created successfully!', 'success');
            } else {
                showMessage(result.message || 'Error saving reservation.', 'error');
            }
        });
    }

    // Filter handlers
    const searchInput = document.getElementById('reservation-search');
    const statusFilter = document.getElementById('reservation-status-filter');
    const dateFilter = document.getElementById('reservation-date-filter');

    if (searchInput) searchInput.addEventListener('input', () => loadReservationsTable());
    if (statusFilter) statusFilter.addEventListener('change', () => loadReservationsTable());
    if (dateFilter) dateFilter.addEventListener('change', () => loadReservationsTable());

    // Details modal handlers
    const detailsClose = document.getElementById('reservation-details-close');
    const detailsCancel = document.getElementById('reservation-details-cancel');
    const detailsModal = document.getElementById('reservation-details-modal');

    if (detailsClose) detailsClose.addEventListener('click', () => detailsModal.style.display = 'none');
    if (detailsCancel) detailsCancel.addEventListener('click', () => detailsModal.style.display = 'none');

    // Approve/Reject buttons
    const approveBtn = document.getElementById('reservation-approve-btn');
    const rejectBtn = document.getElementById('reservation-reject-btn');

    if (approveBtn) {
        approveBtn.addEventListener('click', function() {
            const reservationId = this.dataset.reservationId;
            const admin = getCurrentAdmin();
            const pcNoInput = document.getElementById('reservation-approve-pcno');
            const pcNumber = pcNoInput?.value ? parseInt(pcNoInput.value, 10) : null;
            const result = approveReservation(parseInt(reservationId), admin?.name || 'Admin', { pcNumber });
            if (result.success) {
                detailsModal.style.display = 'none';
                loadReservationsTable();
                loadReservationStats();
                showMessage(result.message || 'Reservation approved!', 'success');
            }
        });
    }

    if (rejectBtn) {
        rejectBtn.addEventListener('click', function() {
            const reservationId = this.dataset.reservationId;
            const reason = prompt('Enter rejection reason (optional):');
            if (reason !== null) {
                const admin = getCurrentAdmin();
                const result = rejectReservation(parseInt(reservationId), admin?.name || 'Admin', reason || '');
                if (result.success) {
                    detailsModal.style.display = 'none';
                    loadReservationsTable();
                    loadReservationStats();
                    showMessage('Reservation rejected.', 'info');
                }
            }
        });
    }

    // Search modal handlers (same as other admin pages)
    setupAdminSearchModal();

    // Logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }
}

function loadReservationStats() {
    const stats = getReservationStats();
    
    const totalEl = document.getElementById('total-reservations');
    const pendingEl = document.getElementById('pending-reservations');
    const approvedEl = document.getElementById('approved-reservations');
    const rejectedEl = document.getElementById('rejected-reservations');

    if (totalEl) totalEl.textContent = stats.total;
    if (pendingEl) pendingEl.textContent = stats.pending;
    if (approvedEl) approvedEl.textContent = stats.approved;
    if (rejectedEl) rejectedEl.textContent = stats.rejected;
}

function loadReservationsTable() {
    const tbody = document.getElementById('reservations-table-body');
    const noDataEl = document.getElementById('no-reservations');
    
    if (!tbody) return;

    let reservations = getReservations();

    // Apply filters
    const searchTerm = document.getElementById('reservation-search')?.value.trim().toLowerCase() || '';
    const statusFilter = document.getElementById('reservation-status-filter')?.value || 'all';
    const dateFilter = document.getElementById('reservation-date-filter')?.value || '';

    if (searchTerm) {
        reservations = reservations.filter(r => 
            r.studentName.toLowerCase().includes(searchTerm) ||
            r.studentId.toLowerCase().includes(searchTerm) ||
            r.lab.toLowerCase().includes(searchTerm) ||
            r.purpose.toLowerCase().includes(searchTerm)
        );
    }

    if (statusFilter !== 'all') {
        reservations = reservations.filter(r => r.status === statusFilter);
    }

    if (dateFilter) {
        reservations = reservations.filter(r => r.date === dateFilter);
    }

    if (reservations.length === 0) {
        tbody.innerHTML = '';
        if (noDataEl) noDataEl.style.display = 'block';
        return;
    }

    if (noDataEl) noDataEl.style.display = 'none';

    tbody.innerHTML = reservations.map(r => {
        const statusClass = r.status === 'approved' ? 'status-approved' :
                           r.status === 'rejected' ? 'status-rejected' :
                           r.status === 'completed' ? 'status-completed' : 'status-pending';
        
        return `
            <tr>
                <td>${r.reservationId}</td>
                <td>
                    <div>${r.studentName}</div>
                    <small style="color: var(--text-muted);">${r.studentId}</small>
                </td>
                <td>${r.lab}</td>
                <td>
                    <div>${new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    <small style="color: var(--text-muted);">${r.startTime} - ${r.endTime}</small>
                </td>
                <td>${r.purpose}</td>
                <td><span class="status-badge ${statusClass}">${r.status}</span></td>
                <td class="actions-cell">
                    <button class="btn-view-reservation" data-id="${r.id}">View</button>
                    ${r.status === 'pending' ? `<button class="btn-approve-reservation" data-id="${r.id}">Approve</button>` : ''}
                    ${r.status === 'pending' ? `<button class="btn-reject-reservation" data-id="${r.id}">Reject</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');

    // Add event listeners
    tbody.querySelectorAll('.btn-view-reservation').forEach(btn => {
        btn.addEventListener('click', function() {
            const reservationId = this.dataset.id;
            openReservationDetails(parseInt(reservationId));
        });
    });

    tbody.querySelectorAll('.btn-approve-reservation').forEach(btn => {
        btn.addEventListener('click', function() {
            const reservationId = this.dataset.id;
            const admin = getCurrentAdmin();
            const result = approveReservation(parseInt(reservationId), admin?.name || 'Admin');
            if (result.success) {
                loadReservationsTable();
                loadReservationStats();
                showMessage(result.message || 'Reservation approved!', 'success');
            }
        });
    });

    tbody.querySelectorAll('.btn-reject-reservation').forEach(btn => {
        btn.addEventListener('click', function() {
            const reservationId = this.dataset.id;
            const reason = prompt('Enter rejection reason (optional):');
            if (reason !== null) {
                const admin = getCurrentAdmin();
                const result = rejectReservation(parseInt(reservationId), admin?.name || 'Admin', reason || '');
                if (result.success) {
                    loadReservationsTable();
                    loadReservationStats();
                    showMessage('Reservation rejected.', 'info');
                }
            }
        });
    });
}

function openReservationModal(reservation = null) {
    const modal = document.getElementById('reservation-modal');
    const title = document.getElementById('reservation-modal-title');
    const form = document.getElementById('reservation-form');

    if (reservation) {
        title.textContent = 'Edit Reservation';
        document.getElementById('edit-reservation-id').value = reservation.id;
        document.getElementById('reservation-student-id').value = reservation.studentId;
        document.getElementById('reservation-student-name').value = reservation.studentName;
        document.getElementById('reservation-lab').value = reservation.lab;
        document.getElementById('reservation-date').value = reservation.date;
        document.getElementById('reservation-start-time').value = reservation.startTime;
        document.getElementById('reservation-end-time').value = reservation.endTime;
        document.getElementById('reservation-purpose').value = reservation.purpose;
        document.getElementById('reservation-notes').value = reservation.notes || '';
        document.getElementById('reservation-submit-btn').textContent = 'Update Reservation';
    } else {
        title.textContent = 'New Reservation';
        document.getElementById('edit-reservation-id').value = '';
        form.reset();
        document.getElementById('reservation-submit-btn').textContent = 'Save Reservation';
        
        // Set default date to today
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('reservation-date').value = today;
    }

    modal.style.display = 'flex';
}

function openReservationDetails(id) {
    const reservation = getReservations().find(r => r.id === id);
    if (!reservation) return;

    const modal = document.getElementById('reservation-details-modal');
    const content = document.getElementById('reservation-details-content');
    const approveBtn = document.getElementById('reservation-approve-btn');
    const rejectBtn = document.getElementById('reservation-reject-btn');

    content.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Reservation ID:</span>
            <span class="detail-value">${reservation.reservationId}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Student:</span>
            <span class="detail-value">${reservation.studentName} (${reservation.studentId})</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Lab:</span>
            <span class="detail-value">${reservation.lab}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Date & Time:</span>
            <span class="detail-value">${new Date(reservation.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Time Slot:</span>
            <span class="detail-value">${reservation.startTime} - ${reservation.endTime}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Purpose:</span>
            <span class="detail-value">${reservation.purpose}</span>
        </div>
        ${reservation.notes ? `
        <div class="detail-row">
            <span class="detail-label">Notes:</span>
            <span class="detail-value">${reservation.notes}</span>
        </div>
        ` : ''}
        <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value"><span class="status-badge status-${reservation.status}">${reservation.status}</span></span>
        </div>
        ${reservation.reviewedBy ? `
        <div class="detail-row">
            <span class="detail-label">Reviewed By:</span>
            <span class="detail-value">${reservation.reviewedBy} on ${new Date(reservation.reviewedAt).toLocaleString()}</span>
        </div>
        ` : ''}
        ${reservation.rejectionReason ? `
        <div class="detail-row">
            <span class="detail-label">Rejection Reason:</span>
            <span class="detail-value">${reservation.rejectionReason}</span>
        </div>
        ` : ''}
        <div class="detail-row">
            <span class="detail-label">Created:</span>
            <span class="detail-value">${new Date(reservation.createdAt).toLocaleString()}</span>
        </div>
    `;

    // Show/hide action buttons based on status
    const pcNoApproveInput = document.getElementById('reservation-approve-pcno');
    if (approveBtn && rejectBtn) {
        if (reservation.status === 'pending') {
            approveBtn.style.display = 'inline-block';
            rejectBtn.style.display = 'inline-block';
            if (pcNoApproveInput) { pcNoApproveInput.style.display = 'inline-block'; pcNoApproveInput.value = ''; }
            approveBtn.dataset.reservationId = id;
            rejectBtn.dataset.reservationId = id;
        } else {
            approveBtn.style.display = 'none';
            rejectBtn.style.display = 'none';
            if (pcNoApproveInput) pcNoApproveInput.style.display = 'none';
        }
    }

    modal.style.display = 'flex';
}

function populateReservationLabSelect() {
    const labSelect = document.getElementById('reservation-lab');
    if (!labSelect) return;

    const labs = getLabRooms();
    labSelect.innerHTML = '<option value="">Select Lab</option>';
    
    labs.forEach(lab => {
        const option = document.createElement('option');
        option.value = lab.name;
        option.textContent = `${lab.name} (Capacity: ${lab.capacity})`;
        if (lab.status !== 'available') {
            option.disabled = true;
            option.textContent += ' - Unavailable';
        }
        labSelect.appendChild(option);
    });
}

// ============================================
// Admin Feedback Page Functions
// ============================================

function initAdminFeedback() {
    if (!isAdminLoggedIn()) {
        window.location.href = 'adminlogin.html';
        return;
    }

    // Initialize admin dropdowns
    initAdminDropdowns();

    // Load feedback statistics
    loadFeedbackStats();

    // Load feedback grid
    loadFeedbackGrid();

    // Export button
    const exportBtn = document.getElementById('export-feedback-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportFeedbackToCSV);
    }

    // Filter handlers
    const searchInput = document.getElementById('feedback-search');
    const typeFilter = document.getElementById('feedback-type-filter');
    const statusFilter = document.getElementById('feedback-status-filter');
    const ratingFilter = document.getElementById('feedback-rating-filter');

    if (searchInput) searchInput.addEventListener('input', () => loadFeedbackGrid());
    if (typeFilter) typeFilter.addEventListener('change', () => loadFeedbackGrid());
    if (statusFilter) statusFilter.addEventListener('change', () => loadFeedbackGrid());
    if (ratingFilter) ratingFilter.addEventListener('change', () => loadFeedbackGrid());

    // Details modal handlers
    const detailsClose = document.getElementById('feedback-details-close');
    const detailsModal = document.getElementById('feedback-details-modal');

    if (detailsClose) detailsClose.addEventListener('click', () => detailsModal.style.display = 'none');

    const closeBtn = document.getElementById('feedback-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => detailsModal.style.display = 'none');

    // Delete button
    const deleteBtn = document.getElementById('feedback-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            const feedbackId = this.dataset.feedbackId;
            if (confirm('Are you sure you want to delete this feedback? This cannot be undone.')) {
                const result = deleteFeedback(parseInt(feedbackId));
                if (result.success) {
                    detailsModal.style.display = 'none';
                    loadFeedbackGrid();
                    loadFeedbackStats();
                    showMessage('Feedback deleted successfully.', 'success');
                }
            }
        });
    }

    // Resolve button
    const resolveBtn = document.getElementById('feedback-resolve-btn');
    if (resolveBtn) {
        resolveBtn.addEventListener('click', function() {
            const feedbackId = this.dataset.feedbackId;
            openResponseModal(parseInt(feedbackId));
        });
    }

    // Response modal handlers
    const responseModal = document.getElementById('feedback-response-modal');
    const responseClose = document.getElementById('feedback-response-close');
    const responseCancel = document.getElementById('feedback-response-cancel');

    if (responseClose) responseClose.addEventListener('click', () => responseModal.style.display = 'none');
    if (responseCancel) responseCancel.addEventListener('click', () => responseModal.style.display = 'none');

    // Response form submit
    const responseForm = document.getElementById('feedback-response-form');
    if (responseForm) {
        responseForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const feedbackId = parseInt(document.getElementById('response-feedback-id').value);
            const response = document.getElementById('admin-response').value.trim();
            const status = document.getElementById('response-status').value;
            const admin = getCurrentAdmin();

            const result = updateFeedback(feedbackId, {
                adminResponse: response,
                status: status,
                respondedAt: new Date().toISOString(),
                respondedBy: admin?.name || 'Admin'
            });

            if (result.success) {
                responseModal.style.display = 'none';
                loadFeedbackGrid();
                loadFeedbackStats();
                showMessage('Response submitted successfully!', 'success');
            }
        });
    }

    // Search modal handlers
    setupAdminSearchModal();

    // Logout
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logoutAdmin();
            window.location.href = 'adminlogin.html';
        });
    }
}

function loadFeedbackStats() {
    const stats = getFeedbackStats();
    
    const totalEl = document.getElementById('total-feedback');
    const pendingEl = document.getElementById('pending-feedback');
    const resolvedEl = document.getElementById('resolved-feedback');
    const avgRatingEl = document.getElementById('average-rating');

    if (totalEl) totalEl.textContent = stats.total;
    if (pendingEl) pendingEl.textContent = stats.pending;
    if (resolvedEl) resolvedEl.textContent = stats.resolved;
    if (avgRatingEl) avgRatingEl.textContent = stats.avgRating;
}

function loadFeedbackGrid() {
    const grid = document.getElementById('feedback-grid');
    const noDataEl = document.getElementById('no-feedback');
    
    if (!grid) return;

    let feedbackList = getFeedback();

    // Apply filters
    const searchTerm = document.getElementById('feedback-search')?.value.trim().toLowerCase() || '';
    const typeFilter = document.getElementById('feedback-type-filter')?.value || 'all';
    const statusFilter = document.getElementById('feedback-status-filter')?.value || 'all';
    const ratingFilter = document.getElementById('feedback-rating-filter')?.value || '0';

    if (searchTerm) {
        feedbackList = feedbackList.filter(f => 
            f.studentName.toLowerCase().includes(searchTerm) ||
            f.studentId.toLowerCase().includes(searchTerm) ||
            f.subject.toLowerCase().includes(searchTerm) ||
            f.message.toLowerCase().includes(searchTerm)
        );
    }

    if (typeFilter !== 'all') {
        feedbackList = feedbackList.filter(f => f.type === typeFilter);
    }

    if (statusFilter !== 'all') {
        feedbackList = feedbackList.filter(f => f.status === statusFilter);
    }

    if (ratingFilter !== '0') {
        feedbackList = feedbackList.filter(f => f.rating >= parseInt(ratingFilter));
    }

    if (feedbackList.length === 0) {
        grid.innerHTML = '';
        if (noDataEl) noDataEl.style.display = 'block';
        return;
    }

    if (noDataEl) noDataEl.style.display = 'none';

    grid.innerHTML = feedbackList.map(f => {
        const statusClass = f.status === 'resolved' ? 'status-approved' :
                           f.status === 'closed' ? 'status-completed' :
                           f.status === 'in-progress' ? 'status-pending' : 'status-pending';
        
        const typeClass = f.type === 'complaint' ? 'type-complaint' :
                         f.type === 'suggestion' ? 'type-suggestion' :
                         f.type === 'appreciation' ? 'type-appreciation' :
                         f.type === 'incident' ? 'type-incident' : 'type-other';

        const stars = '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating);

        return `
            <div class="feedback-card ${typeClass}">
                <div class="feedback-header">
                    <div class="feedback-type-badge">${f.type}</div>
                    <span class="status-badge ${statusClass}">${f.status}</span>
                </div>
                <div class="feedback-body">
                    <div class="feedback-stars">${stars}</div>
                    <h4 class="feedback-subject">${f.subject || 'No Subject'}</h4>
                    <p class="feedback-message">${f.message.substring(0, 150)}${f.message.length > 150 ? '...' : ''}</p>
                </div>
                <div class="feedback-footer">
                    <div class="feedback-student">
                        <strong>${f.studentName}</strong>
                        <small>${f.studentId}</small>
                    </div>
                    <div class="feedback-date">
                        ${new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                </div>
                <div class="feedback-actions">
                    <button class="btn-view-feedback" data-id="${f.id}">View Details</button>
                    ${f.status === 'pending' ? '<button class="btn-respond-feedback" data-id="' + f.id + '">Respond</button>' : ''}
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    grid.querySelectorAll('.btn-view-feedback').forEach(btn => {
        btn.addEventListener('click', function() {
            const feedbackId = this.dataset.id;
            openFeedbackDetails(parseInt(feedbackId));
        });
    });

    grid.querySelectorAll('.btn-respond-feedback').forEach(btn => {
        btn.addEventListener('click', function() {
            const feedbackId = this.dataset.id;
            openResponseModal(parseInt(feedbackId));
        });
    });
}

function openFeedbackDetails(id) {
    const feedback = getFeedback().find(f => f.id === id);
    if (!feedback) return;

    const modal = document.getElementById('feedback-details-modal');
    const content = document.getElementById('feedback-details-content');
    const deleteBtn = document.getElementById('feedback-delete-btn');
    const resolveBtn = document.getElementById('feedback-resolve-btn');

    const stars = '★'.repeat(feedback.rating) + '☆'.repeat(5 - feedback.rating);

    content.innerHTML = `
        <div class="feedback-detail-header">
            <span class="feedback-type-badge">${feedback.type}</span>
            <span class="status-badge status-${feedback.status}">${feedback.status}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Feedback ID:</span>
            <span class="detail-value">${feedback.feedbackId}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Student:</span>
            <span class="detail-value">${feedback.studentName} (${feedback.studentId})</span>
        </div>
        ${feedback.email ? `
        <div class="detail-row">
            <span class="detail-label">Email:</span>
            <span class="detail-value">${feedback.email}</span>
        </div>
        ` : ''}
        <div class="detail-row">
            <span class="detail-label">Rating:</span>
            <span class="detail-value feedback-stars-large">${stars}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Subject:</span>
            <span class="detail-value">${feedback.subject || 'No Subject'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Message:</span>
            <div class="detail-value feedback-message-full">${feedback.message}</div>
        </div>
        ${feedback.adminResponse ? `
        <div class="detail-row admin-response-row">
            <span class="detail-label">Admin Response:</span>
            <div class="detail-value admin-response">${feedback.adminResponse}</div>
        </div>
        <div class="detail-row">
            <span class="detail-label">Responded By:</span>
            <span class="detail-value">${feedback.respondedBy} on ${new Date(feedback.respondedAt).toLocaleString()}</span>
        </div>
        ` : ''}
        <div class="detail-row">
            <span class="detail-label">Submitted:</span>
            <span class="detail-value">${new Date(feedback.createdAt).toLocaleString()}</span>
        </div>
    `;

    // Show/hide action buttons
    if (deleteBtn && resolveBtn) {
        deleteBtn.dataset.feedbackId = id;
        resolveBtn.dataset.feedbackId = id;
        
        if (feedback.status === 'resolved' || feedback.status === 'closed') {
            resolveBtn.style.display = 'none';
        } else {
            resolveBtn.style.display = 'inline-block';
        }
    }

    modal.style.display = 'flex';
}

function openResponseModal(feedbackId) {
    const modal = document.getElementById('feedback-response-modal');
    const form = document.getElementById('feedback-response-form');
    
    document.getElementById('response-feedback-id').value = feedbackId;
    document.getElementById('admin-response').value = '';
    document.getElementById('response-status').value = 'pending';
    
    modal.style.display = 'flex';
}

function exportFeedbackToCSV() {
    const feedbackList = getFeedback();
    
    if (feedbackList.length === 0) {
        showMessage('No feedback to export.', 'info');
        return;
    }

    const headers = ['Feedback ID', 'Student ID', 'Student Name', 'Email', 'Type', 'Subject', 'Message', 'Rating', 'Status', 'Admin Response', 'Created At'];
    const csv = [
        headers.join(','),
        ...feedbackList.map(f => [
            f.feedbackId,
            f.studentId,
            `"${f.studentName}"`,
            `"${f.email || ''}"`,
            f.type,
            `"${f.subject || ''}"`,
            `"${f.message.replace(/"/g, '""')}"`,
            f.rating,
            f.status,
            `"${f.adminResponse ? f.adminResponse.replace(/"/g, '""') : ''}"`,
            new Date(f.createdAt).toISOString()
        ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feedback_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    showMessage('Feedback exported successfully!', 'success');
}

// ============================================
// Helper Function for Admin Search Modal
// ============================================

function setupAdminSearchModal() {
    const searchNav = document.getElementById('nav-search');
    const searchModal = document.getElementById('search-modal');
    const searchModalClose = document.getElementById('search-modal-close');
    const searchForm = document.getElementById('search-form');

    if (searchNav && searchModal) {
        searchNav.addEventListener('click', function(e) {
            e.preventDefault();
            searchModal.style.display = 'flex';
        });
    }

    if (searchModalClose && searchModal) {
        searchModalClose.addEventListener('click', () => {
            searchModal.style.display = 'none';
            document.getElementById('search-input').value = '';
            document.getElementById('search-results').innerHTML = '';
        });
    }

    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const searchTerm = document.getElementById('search-input').value.trim();
            if (!searchTerm) return;

            const users = getUsers();
            const results = users.filter(u =>
                u.idNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (u.firstName + ' ' + u.lastName).toLowerCase().includes(searchTerm.toLowerCase())
            );

            const resultsDiv = document.getElementById('search-results');
            if (resultsDiv) {
                if (results.length === 0) {
                    resultsDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No students found.</p>';
                } else {
                    resultsDiv.innerHTML = results.map(u => `
                        <div style="padding: 0.75rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong>${u.firstName} ${u.lastName}</strong><br>
                                <small style="color: var(--text-muted);">${u.idNumber} | ${u.course}</small>
                            </div>
                            <a href="adminstudents.html" style="color: var(--primary-blue); text-decoration: none; font-size: 0.85rem;">View</a>
                        </div>
                    `).join('');
                }
            }
        });
    }

    if (searchModal) {
        searchModal.addEventListener('click', function(e) {
            if (e.target === searchModal) {
                searchModal.style.display = 'none';
                document.getElementById('search-input').value = '';
                document.getElementById('search-results').innerHTML = '';
            }
        });
    }
}

// ============================================
// Initialize on Page Load
// ============================================

function loadPublicLeaderboard() {
    const listEl = document.getElementById('public-lb-list');
    const listElOut = document.getElementById('public-lb-list-loggedout');
    if (!listEl && !listElOut) return;

    const records = getSitInRecords();
    const users = getUsers();

    const user = getCurrentUser();
    if (user) {
        const loggedOutSection = document.getElementById('public-leaderboard-section');
        if (loggedOutSection) loggedOutSection.style.display = 'none';
    }

    if (records.length === 0) {
        if (listEl) listEl.innerHTML = '<p class="no-history-msg">No session data yet.</p>';
        if (listElOut) listElOut.innerHTML = '<p class="no-history-msg">No session data yet.</p>';
        return;
    }

    const totals = {};
    records.forEach(r => {
        if (!r.idNumber) return;
        if (!totals[r.idNumber]) totals[r.idNumber] = { sessions: 0, minutes: 0 };
        totals[r.idNumber].sessions++;
        if (r.startTime && r.endTime) {
            const dur = new Date(r.endTime) - new Date(r.startTime);
            if (!isNaN(dur) && dur > 0) totals[r.idNumber].minutes += dur / 60000;
        }
    });

    const leaderboard = Object.keys(totals).map(id => {
        const user = users.find(u => u.idNumber === id);
        return {
            idNumber: id,
            name: user ? `${user.firstName} ${user.lastName}` : id,
            course: user?.course || '',
            sessions: totals[id].sessions,
            minutes: Math.floor(totals[id].minutes)
        };
    }).sort((a, b) => b.minutes - a.minutes).slice(0, 10);

    const medals = ['🥇', '🥈', '🥉'];
    const html = leaderboard.map((entry, i) => {
        const h = Math.floor(entry.minutes / 60);
        const m = entry.minutes % 60;
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        const rankClass = i < 3 ? `pub-lb-rank-${i + 1}` : '';
        const medal = medals[i] || `#${i + 1}`;
        return `<div class="pub-lb-entry ${rankClass}">
            <span class="pub-lb-medal">${medal}</span>
            <div class="pub-lb-info">
                <span class="pub-lb-name">${escapeHTML(entry.name)}</span>
                <span class="pub-lb-course">${escapeHTML(entry.course)}</span>
            </div>
            <div class="pub-lb-stats">
                <span class="pub-lb-hours">${timeStr}</span>
                <span class="pub-lb-sessions">${entry.sessions} sessions</span>
            </div>
        </div>`;
    }).join('');

    if (listEl) listEl.innerHTML = html;
    if (listElOut) listElOut.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', async function() {
    // Initialize default admin
    initDefaultAdmin();

    // Initialize theme first
    initTheme();
    initThemeToggle();

    // Initialize password toggles on all pages
    initPasswordToggles();
    initPasswordStrength();

    await restoreSupabaseUserSession();

    // Check which page we're on and initialize accordingly
    const currentPage = window.location.pathname.split('/').pop();
    const user = getCurrentUser();

    // Redirect logged-in users away from auth pages
    if (user) {
        if (currentPage === 'loginpage.html' || currentPage === 'registrationpage.html') {
            showMessage('You are already logged in.', 'info');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);
            return;
        }
    }

    // Admin pages initialization
    if (currentPage === 'adminlogin.html') {
        initAdminLogin();
    } else if (currentPage === 'admindashboard.html') {
        initAdminDashboard();
    } else if (currentPage === 'adminstudents.html') {
        initAdminStudents();
    } else if (currentPage === 'adminsitin.html') {
        initAdminSitIn();
    } else if (currentPage === 'adminrecords.html') {
        initAdminRecords();
    } else if (currentPage === 'adminreports.html') {
        // adminreports.html redirects to records page
        window.location.replace('adminrecords.html');
    } else if (currentPage === 'adminlabs.html') {
        initAdminLabs();
    } else if (currentPage === 'adminfeedback.html') {
        initAdminFeedback();
    } else if (currentPage === 'adminreservation.html') {
        initAdminReservation();
    }
    
    // Initialize dropdowns on any admin page (as a fallback)
    if (currentPage.startsWith('admin')) {
        initAdminDropdowns();
    }
    // Other admin pages use placeholder content

    // Student pages initialization
    if (currentPage === 'registrationpage.html') {
        initRegistrationForm();
    } else if (currentPage === 'loginpage.html') {
        initLoginForm();
    } else if (currentPage === 'index.html' || currentPage === '') {
        updateLandingPageForLoggedInUser();
        loadPublicLeaderboard();
    } else if (currentPage === 'editprofile.html') {
        initEditProfilePage();
    } else if (currentPage === 'feedbackpage.html') {
        initFeedbackPage();
    }

    // Update navigation for logged in users on all pages
    updateNavForLoggedInUser();

    // Log current auth status for debugging
    console.log('Current User:', getCurrentUser());
    console.log('Is Logged In:', isLoggedIn());
});

