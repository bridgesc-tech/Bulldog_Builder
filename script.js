// Bulldog Builder Application - Weight Lifting Tracker
// Uses IndexedDB for primary storage with optional Firebase sync

class BulldogBuilder {
    constructor() {
        this.db = null;
        this.dbName = 'BulldogBuilderDB';
        this.dbVersion = 5; // Incremented to add gender index to periods
        this.athletes = [];
        this.weighIns = [];
        this.periods = [];
        this.athleteLifts = []; // Store max lifts/runs per athlete per period
        this.currentPeriodId = null;
        this.firebaseEnabled = false;
        this.syncId = this.getOrCreateSyncId();
        this.currentAthleteId = null;
        this.viewingAthleteId = null;
        this.viewingAthletePeriodId = null;
        this.editingAthleteId = null;
        this.editingWeighInId = null;
        this.currentGender = 'Boy'; // Default to Boys view
        this.currentClassFilter = null; // Current class filter (null = all classes)
        this.weighInsSortColumn = 'Player'; // Default sort column
        this.weighInsSortDirection = 'asc'; // Default sort direction
        this.progressCharts = {
            lifts: null,
            runs: null,
            rating: null,
            vert: null
        };
        
        // Physical attributes (Weight and Height)
        this.physicalAttributes = [
            { id: 'weight', name: 'Weight', unit: 'lbs', isWeight: true },
            { id: 'height', name: 'Height', unit: 'inches', isWeight: false }
        ];
        
        // Lift/Run definitions
        this.lifts = [
            { id: 'bench', name: 'Bench', unit: 'lbs', isWeight: true },
            { id: 'dead', name: 'Dead', unit: 'lbs', isWeight: true },
            { id: 'squat', name: 'Squat', unit: 'lbs', isWeight: true },
            { id: 'clean', name: 'Clean', unit: 'lbs', isWeight: true },
            { id: 'incline', name: 'Incline', unit: 'lbs', isWeight: true },
            { id: 'vert', name: 'Vert', unit: 'inches', isWeight: false },
            { id: 'forty', name: 'Forty', unit: 'seconds', isWeight: false },
            { id: 'agility', name: 'Agility', unit: 'seconds', isWeight: false }
        ];
        
        // Initialize IndexedDB first
        this.initIndexedDB().then(() => {
            // Wait for Firebase scripts to load
            this.waitForFirebase(() => {
                this.initializeFirebase();
                this.loadData().then(() => {
                    this.initializeApp();
                }).catch(error => {
                    console.error('Error loading data:', error);
                    this.initializeApp();
                });
            });
        });
    }

    // IndexedDB Setup
    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB opened successfully');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;
                
                // Create athletes store
                if (!db.objectStoreNames.contains('athletes')) {
                    const athletesStore = db.createObjectStore('athletes', { keyPath: 'id', autoIncrement: false });
                    athletesStore.createIndex('name', 'name', { unique: false });
                }
                
                // Create or update weighIns store (keeping 'workouts' for backward compatibility)
                let weighInsStore;
                if (!db.objectStoreNames.contains('workouts')) {
                    weighInsStore = db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: false });
                    weighInsStore.createIndex('athleteId', 'athleteId', { unique: false });
                    weighInsStore.createIndex('date', 'date', { unique: false });
                    weighInsStore.createIndex('athleteDate', ['athleteId', 'date'], { unique: false });
                    weighInsStore.createIndex('periodId', 'periodId', { unique: false });
                } else {
                    weighInsStore = transaction.objectStore('workouts');
                    // Add periodId index if it doesn't exist
                    if (!weighInsStore.indexNames.contains('periodId')) {
                        weighInsStore.createIndex('periodId', 'periodId', { unique: false });
                    }
                }
                
                // Create or update periods store
                let periodsStore;
                if (!db.objectStoreNames.contains('periods')) {
                    periodsStore = db.createObjectStore('periods', { keyPath: 'id', autoIncrement: false });
                    periodsStore.createIndex('name', 'name', { unique: false });
                    periodsStore.createIndex('gender', 'gender', { unique: false });
                } else {
                    periodsStore = transaction.objectStore('periods');
                    // Add gender index if it doesn't exist
                    if (!periodsStore.indexNames.contains('gender')) {
                        periodsStore.createIndex('gender', 'gender', { unique: false });
                    }
                }
                
                // Create or update athleteLifts store (max lifts/runs per athlete per period)
                let athleteLiftsStore;
                if (!db.objectStoreNames.contains('athleteLifts')) {
                    athleteLiftsStore = db.createObjectStore('athleteLifts', { keyPath: 'id', autoIncrement: false });
                    athleteLiftsStore.createIndex('athleteId', 'athleteId', { unique: false });
                    athleteLiftsStore.createIndex('periodId', 'periodId', { unique: false });
                    athleteLiftsStore.createIndex('athletePeriod', ['athleteId', 'periodId'], { unique: false });
                } else {
                    athleteLiftsStore = transaction.objectStore('athleteLifts');
                    // Add periodId index if it doesn't exist
                    if (!athleteLiftsStore.indexNames.contains('periodId')) {
                        athleteLiftsStore.createIndex('periodId', 'periodId', { unique: false });
                    }
                }
                
                console.log('IndexedDB stores created');
            };
        });
    }

    // IndexedDB CRUD Operations - Athletes
    async addAthlete(athlete) {
        athlete.id = athlete.id || this.generateId();
        athlete.createdAt = new Date().toISOString();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athletes'], 'readwrite');
            const store = transaction.objectStore('athletes');
            const request = store.add(athlete);
            
            request.onsuccess = () => {
                this.athletes.push(athlete);
                this.syncToFirebase('athletes', athlete);
                resolve(athlete);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async updateAthlete(athlete) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athletes'], 'readwrite');
            const store = transaction.objectStore('athletes');
            const request = store.put(athlete);
            
            request.onsuccess = () => {
                const index = this.athletes.findIndex(a => a.id === athlete.id);
                if (index !== -1) {
                    this.athletes[index] = athlete;
                }
                this.syncToFirebase('athletes', athlete);
                resolve(athlete);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deleteAthlete(athleteId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athletes'], 'readwrite');
            const store = transaction.objectStore('athletes');
            const request = store.delete(athleteId);
            
            request.onsuccess = () => {
                this.athletes = this.athletes.filter(a => a.id !== athleteId);
                // Also delete all weigh ins for this athlete
                this.deleteWeighInsByAthlete(athleteId);
                this.syncToFirebase('athletes', null, athleteId);
                resolve();
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getAllAthletes() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athletes'], 'readonly');
            const store = transaction.objectStore('athletes');
            const request = store.getAll();
            
            request.onsuccess = () => {
                this.athletes = request.result;
                resolve(this.athletes);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    // IndexedDB CRUD Operations - Weigh Ins
    async addWeighIn(weighIn) {
        weighIn.id = weighIn.id || this.generateId();
        weighIn.createdAt = new Date().toISOString();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workouts'], 'readwrite');
            const store = transaction.objectStore('workouts');
            const request = store.add(weighIn);
            
            request.onsuccess = () => {
                this.weighIns.push(weighIn);
                this.syncToFirebase('weighIns', weighIn);
                resolve(weighIn);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async updateWeighIn(weighIn) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workouts'], 'readwrite');
            const store = transaction.objectStore('workouts');
            const request = store.put(weighIn);
            
            request.onsuccess = () => {
                const index = this.weighIns.findIndex(w => w.id === weighIn.id);
                if (index !== -1) {
                    this.weighIns[index] = weighIn;
                }
                this.syncToFirebase('weighIns', weighIn);
                resolve(weighIn);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deleteWeighIn(weighInId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workouts'], 'readwrite');
            const store = transaction.objectStore('workouts');
            const request = store.delete(weighInId);
            
            request.onsuccess = () => {
                this.weighIns = this.weighIns.filter(w => w.id !== weighInId);
                this.syncToFirebase('weighIns', null, weighInId);
                resolve();
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deleteWeighInsByAthlete(athleteId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workouts'], 'readwrite');
            const store = transaction.objectStore('workouts');
            const index = store.index('athleteId');
            const request = index.getAll(athleteId);
            
            request.onsuccess = () => {
                const weighInsToDelete = request.result;
                weighInsToDelete.forEach(weighIn => {
                    store.delete(weighIn.id);
                    this.weighIns = this.weighIns.filter(w => w.id !== weighIn.id);
                });
                resolve();
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getWeighInsByAthlete(athleteId, periodId = null) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workouts'], 'readonly');
            const store = transaction.objectStore('workouts');
            const index = store.index('athleteId');
            const request = index.getAll(athleteId);
            
            request.onsuccess = () => {
                let weighIns = request.result;
                // Filter by period if specified
                if (periodId) {
                    weighIns = weighIns.filter(w => w.periodId === periodId);
                }
                resolve(weighIns);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getAllWeighIns() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workouts'], 'readonly');
            const store = transaction.objectStore('workouts');
            const request = store.getAll();
            
            request.onsuccess = () => {
                this.weighIns = request.result;
                resolve(this.weighIns);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    // IndexedDB CRUD Operations - Periods
    async addPeriod(period) {
        period.id = period.id || this.generateId();
        period.createdAt = new Date().toISOString();
        // Ensure gender is set (default to current gender if not provided)
        if (!period.gender) {
            period.gender = this.currentGender;
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['periods'], 'readwrite');
            const store = transaction.objectStore('periods');
            const request = store.add(period);
            
            request.onsuccess = () => {
                this.periods.push(period);
                this.syncToFirebase('periods', period);
                resolve(period);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async updatePeriod(period) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['periods'], 'readwrite');
            const store = transaction.objectStore('periods');
            const request = store.put(period);
            
            request.onsuccess = () => {
                const index = this.periods.findIndex(p => p.id === period.id);
                if (index !== -1) {
                    this.periods[index] = period;
                }
                this.syncToFirebase('periods', period);
                resolve(period);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deletePeriod(periodId) {
        return new Promise(async (resolve, reject) => {
            try {
                const transaction = this.db.transaction(['periods'], 'readwrite');
                const store = transaction.objectStore('periods');
                const request = store.delete(periodId);
                
                request.onsuccess = async () => {
                    try {
                        this.periods = this.periods.filter(p => p.id !== periodId);
                        // Also delete all weigh ins for this period
                        await this.deleteWeighInsByPeriod(periodId);
                        // Delete all athlete lifts for this period
                        await this.deleteAthleteLiftsByPeriod(periodId);
                        this.syncToFirebase('periods', null, periodId);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                
                request.onerror = () => {
                    reject(request.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async getAllPeriods() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['periods'], 'readonly');
            const store = transaction.objectStore('periods');
            const request = store.getAll();
            
            request.onsuccess = async () => {
                this.periods = request.result;
                // Set default gender for existing periods that don't have one
                const periodsToUpdate = this.periods.filter(p => !p.gender);
                if (periodsToUpdate.length > 0) {
                    // Update periods that don't have gender (backward compatibility)
                    for (const period of periodsToUpdate) {
                        period.gender = 'Boy'; // Default to Boy for backward compatibility
                        await this.updatePeriod(period);
                    }
                }
                resolve(this.periods);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deleteWeighInsByPeriod(periodId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workouts'], 'readwrite');
            const store = transaction.objectStore('workouts');
            
            // Try to use index if it exists, otherwise iterate through all records
            let request;
            let useIndex = false;
            try {
                if (store.indexNames.contains('periodId')) {
                    const index = store.index('periodId');
                    request = index.getAll(periodId);
                    useIndex = true;
                } else {
                    request = store.getAll();
                }
            } catch (error) {
                // Index doesn't exist, get all and filter
                request = store.getAll();
            }
            
            request.onsuccess = () => {
                try {
                    let weighInsToDelete = request.result;
                    
                    // If we got all records (no index), filter by periodId
                    if (!useIndex) {
                        weighInsToDelete = weighInsToDelete.filter(w => w.periodId === periodId);
                    }
                    
                    if (weighInsToDelete.length === 0) {
                        resolve();
                        return;
                    }
                    
                    let completed = 0;
                    const total = weighInsToDelete.length;
                    
                    weighInsToDelete.forEach(weighIn => {
                        const deleteRequest = store.delete(weighIn.id);
                        deleteRequest.onsuccess = () => {
                            this.weighIns = this.weighIns.filter(w => w.id !== weighIn.id);
                            completed++;
                            if (completed === total) {
                                resolve();
                            }
                        };
                        deleteRequest.onerror = () => {
                            reject(deleteRequest.error);
                        };
                    });
                } catch (error) {
                    reject(error);
                }
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deleteAthleteLiftsByPeriod(periodId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athleteLifts'], 'readwrite');
            const store = transaction.objectStore('athleteLifts');
            
            // Try to use index if it exists, otherwise iterate through all records
            let request;
            let useIndex = false;
            try {
                if (store.indexNames.contains('periodId')) {
                    const index = store.index('periodId');
                    request = index.getAll(periodId);
                    useIndex = true;
                } else {
                    request = store.getAll();
                }
            } catch (error) {
                // Index doesn't exist, get all and filter
                request = store.getAll();
            }
            
            request.onsuccess = () => {
                try {
                    let liftsToDelete = request.result;
                    
                    // If we got all records (no index), filter by periodId
                    if (!useIndex) {
                        liftsToDelete = liftsToDelete.filter(l => l.periodId === periodId);
                    }
                    
                    if (liftsToDelete.length === 0) {
                        resolve();
                        return;
                    }
                    
                    let completed = 0;
                    const total = liftsToDelete.length;
                    
                    liftsToDelete.forEach(lift => {
                        const deleteRequest = store.delete(lift.id);
                        deleteRequest.onsuccess = () => {
                            this.athleteLifts = this.athleteLifts.filter(l => l.id !== lift.id);
                            completed++;
                            if (completed === total) {
                                resolve();
                            }
                        };
                        deleteRequest.onerror = () => {
                            reject(deleteRequest.error);
                        };
                    });
                } catch (error) {
                    reject(error);
                }
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    // IndexedDB CRUD Operations - Athlete Lifts
    async saveAthleteLifts(athleteLifts) {
        athleteLifts.id = athleteLifts.id || this.generateId();
        athleteLifts.updatedAt = new Date().toISOString();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athleteLifts'], 'readwrite');
            const store = transaction.objectStore('athleteLifts');
            const request = store.put(athleteLifts);
            
            request.onsuccess = () => {
                const index = this.athleteLifts.findIndex(l => l.id === athleteLifts.id);
                if (index !== -1) {
                    this.athleteLifts[index] = athleteLifts;
                } else {
                    this.athleteLifts.push(athleteLifts);
                }
                this.syncToFirebase('athleteLifts', athleteLifts);
                resolve(athleteLifts);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getAthleteLifts(athleteId, periodId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athleteLifts'], 'readonly');
            const store = transaction.objectStore('athleteLifts');
            const index = store.index('athletePeriod');
            const request = index.get([athleteId, periodId]);
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getAllAthleteLifts() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['athleteLifts'], 'readonly');
            const store = transaction.objectStore('athleteLifts');
            const request = store.getAll();
            
            request.onsuccess = () => {
                this.athleteLifts = request.result;
                resolve(this.athleteLifts);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    // Utility Functions
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    getOrCreateSyncId() {
        let syncId = localStorage.getItem('bulldogBuilderSyncId');
        if (!syncId) {
            syncId = Math.floor(100000 + Math.random() * 900000).toString();
            localStorage.setItem('bulldogBuilderSyncId', syncId);
        }
        return syncId;
    }

    // Firebase Sync (Optional - Background Sync)
    waitForFirebase(callback, attempts = 0) {
        const maxAttempts = 20;
        if (typeof firebase !== 'undefined' || attempts >= maxAttempts || window.location.protocol === 'file:') {
            callback();
        } else {
            setTimeout(() => {
                this.waitForFirebase(callback, attempts + 1);
            }, 100);
        }
    }

    initializeFirebase() {
        const checkFirebase = () => {
            // Check for window.db (from firebase-config.js) or global db
            const firebaseDb = (typeof window !== 'undefined' && window.db) ? window.db : (typeof db !== 'undefined' ? db : null);
            
            if (typeof window !== 'undefined' && firebaseDb !== null && window.location.protocol !== 'file:') {
                this.firebaseEnabled = true;
                console.log('Firebase sync enabled for sync ID:', this.syncId);
                this.updateSyncStatus();
                this.updateSettingsModal();
                return true;
            }
            return false;
        };
        
        if (!checkFirebase()) {
            // Listen for Firebase ready event
            window.addEventListener('firebaseReady', () => {
                if (checkFirebase()) {
                    // Set up real-time listener
                    this.setupFirebaseListener();
                }
            });
            
            setTimeout(() => {
                if (!checkFirebase()) {
                    console.log('Firebase not configured - running in IndexedDB-only mode');
                    this.updateSyncStatus();
                    this.updateSettingsModal();
                } else {
                    this.setupFirebaseListener();
                }
            }, 500);
        } else {
            this.setupFirebaseListener();
        }
    }

    setupFirebaseListener() {
        if (!this.firebaseEnabled || window.location.protocol === 'file:') return;
        
        const firebaseDb = (typeof window !== 'undefined' && window.db) ? window.db : (typeof db !== 'undefined' ? db : null);
        if (!firebaseDb) return;

        // Listen for real-time updates
        firebaseDb.collection('bulldogBuilder').doc(this.syncId)
            .onSnapshot((docSnapshot) => {
                if (docSnapshot.exists) {
                    const data = docSnapshot.data();
                    console.log('Real-time sync from Firebase');
                    // Merge data (IndexedDB is primary, Firebase is backup)
                    this.mergeFirebaseData(data);
                }
            }, (error) => {
                console.error('Firebase listener error:', error);
            });
    }

    async mergeFirebaseData(data) {
        // Merge athletes
        if (data.athletes && Array.isArray(data.athletes)) {
            for (const athlete of data.athletes) {
                const exists = this.athletes.find(a => a.id === athlete.id);
                if (!exists) {
                    await this.addAthlete(athlete);
                }
            }
        }
        
        // Merge weigh ins
        if (data.weighIns && Array.isArray(data.weighIns)) {
            for (const weighIn of data.weighIns) {
                const exists = this.weighIns.find(w => w.id === weighIn.id);
                if (!exists) {
                    await this.addWeighIn(weighIn);
                }
            }
        }
        
        // Merge periods
        if (data.periods && Array.isArray(data.periods)) {
            for (const period of data.periods) {
                const exists = this.periods.find(p => p.id === period.id);
                if (!exists) {
                    await this.addPeriod(period);
                }
            }
        }
        
        // Merge athlete lifts
        if (data.athleteLifts && Array.isArray(data.athleteLifts)) {
            for (const athleteLift of data.athleteLifts) {
                const exists = this.athleteLifts.find(l => l.id === athleteLift.id);
                if (!exists) {
                    await this.saveAthleteLifts(athleteLift);
                }
            }
        }
        
        // Re-render UI
        this.renderAthletes();
        this.renderPeriods();
        this.updateAthleteSelects();
    }

    async syncToFirebase(type, data, deleteId = null) {
        if (!this.firebaseEnabled || window.location.protocol === 'file:') {
            return;
        }

        try {
            const firebaseDb = (typeof window !== 'undefined' && window.db) ? window.db : (typeof db !== 'undefined' ? db : null);
            if (!firebaseDb) return;

            const syncData = {
                athletes: this.athletes,
                weighIns: this.weighIns,
                periods: this.periods,
                athleteLifts: this.athleteLifts,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            };

            await firebaseDb.collection('bulldogBuilder').doc(this.syncId).set(syncData, { merge: true });
            console.log('Synced to Firebase:', type);
        } catch (error) {
            console.error('Error syncing to Firebase:', error);
        }
    }

    async manualSyncToFirebase() {
        if (!this.firebaseEnabled || window.location.protocol === 'file:') {
            const messageEl = document.getElementById('firebaseSyncMessage');
            if (messageEl) {
                messageEl.textContent = 'Firebase requires HTTP/HTTPS. Deploy to GitHub Pages to enable sync.';
                messageEl.style.color = '#e74c3c';
            }
            return;
        }

        const messageEl = document.getElementById('firebaseSyncMessage');
        if (messageEl) {
            messageEl.textContent = 'Syncing...';
            messageEl.style.color = '#4169E1';
        }

        try {
            await this.syncToFirebase('manual', null);
            if (messageEl) {
                messageEl.textContent = '✓ Synced successfully!';
                messageEl.style.color = '#52C41A';
                setTimeout(() => {
                    messageEl.textContent = '';
                }, 3000);
            }
        } catch (error) {
            console.error('Manual sync error:', error);
            if (messageEl) {
                messageEl.textContent = '✗ Sync failed. Please try again.';
                messageEl.style.color = '#e74c3c';
            }
        }
    }

    updateSettingsModal() {
        const syncStatusEl = document.getElementById('firebaseSyncStatus');
        const syncIdEl = document.getElementById('firebaseSyncId');
        
        if (syncStatusEl) {
            if (this.firebaseEnabled) {
                syncStatusEl.textContent = '☁️ Connected';
                syncStatusEl.style.color = '#52C41A';
            } else if (window.location.protocol === 'file:') {
                syncStatusEl.textContent = '📁 File Protocol (Disabled)';
                syncStatusEl.style.color = '#FAAD14';
            } else {
                syncStatusEl.textContent = '❌ Not Available';
                syncStatusEl.style.color = '#e74c3c';
            }
        }
        
        if (syncIdEl) {
            syncIdEl.textContent = this.syncId;
        }
    }

    async loadData() {
        // Load from IndexedDB first (primary source)
        await this.getAllAthletes();
        await this.getAllWeighIns();
        await this.getAllPeriods();
        await this.getAllAthleteLifts();
        
        // Remove any default periods that were created previously
        const defaultPeriods = this.periods.filter(p => p.name === 'Default Period' || p.isDefault);
        for (const period of defaultPeriods) {
            await this.deletePeriod(period.id);
        }
        // Clear current period if it was a default period
        if (this.currentPeriodId && defaultPeriods.find(p => p.id === this.currentPeriodId)) {
            this.currentPeriodId = null;
        }

        // Optionally sync from Firebase if enabled
        const firebaseDb = (typeof window !== 'undefined' && window.db) ? window.db : (typeof db !== 'undefined' ? db : null);
        if (this.firebaseEnabled && firebaseDb) {
            try {
                const docSnapshot = await firebaseDb.collection('bulldogBuilder').doc(this.syncId).get();
                if (docSnapshot.exists) {
                    const data = docSnapshot.data();
                    
                    // Merge Firebase data with IndexedDB (Firebase is backup)
                    if (data.athletes && data.athletes.length > 0) {
                        for (const athlete of data.athletes) {
                            const exists = this.athletes.find(a => a.id === athlete.id);
                            if (!exists) {
                                await this.addAthlete(athlete);
                            }
                        }
                    }
                    
                    if (data.weighIns && data.weighIns.length > 0) {
                        for (const weighIn of data.weighIns) {
                            const exists = this.weighIns.find(w => w.id === weighIn.id);
                            if (!exists) {
                                await this.addWeighIn(weighIn);
                            }
                        }
                    }
                    
                    if (data.periods && data.periods.length > 0) {
                        for (const period of data.periods) {
                            const exists = this.periods.find(p => p.id === period.id);
                            if (!exists) {
                                await this.addPeriod(period);
                            }
                        }
                    }
                    
                    if (data.athleteLifts && data.athleteLifts.length > 0) {
                        for (const athleteLift of data.athleteLifts) {
                            const exists = this.athleteLifts.find(l => l.id === athleteLift.id);
                            if (!exists) {
                                await this.saveAthleteLifts(athleteLift);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error loading from Firebase:', error);
            }
        }
    }

    // UI Functions
    updateSyncStatus() {
        const syncStatus = document.getElementById('syncStatus');
        if (syncStatus) {
            if (this.firebaseEnabled) {
                syncStatus.textContent = '☁️ Cloud Sync Active';
                syncStatus.style.color = '#52C41A';
            } else {
                syncStatus.textContent = '💾 Local Storage Only';
                syncStatus.style.color = '#FAAD14';
            }
        }
    }

    async initializeApp() {
        // Register service worker
        if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
            navigator.serviceWorker.register('./service-worker.js')
                .then(reg => console.log('Service Worker registered'))
                .catch(err => {});
        }

        this.setupTabNavigation();
        this.setupAthletes();
        this.setupWeighIns();
        this.setupPeriods();
        this.setupProgress();
        this.setupModals();
        this.setupGenderToggle();
        this.setupClassFilter();
        this.setupSettings();
        this.updateGenderToggleButton();
        await this.updateClassFilter();
        this.renderAthletes();
        this.updateAthleteSelects();
        
        // Render periods on load (will show on Weigh Ins tab)
        this.renderPeriods();
    }

    setupSettings() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettingsModal = document.getElementById('closeSettingsModal');
        const manualSyncBtn = document.getElementById('manualSyncBtn');

        if (settingsBtn && settingsModal) {
            settingsBtn.addEventListener('click', () => {
                this.updateSettingsModal();
                settingsModal.style.display = 'block';
            });
        }

        if (closeSettingsModal && settingsModal) {
            closeSettingsModal.addEventListener('click', () => {
                settingsModal.style.display = 'none';
            });
        }

        if (manualSyncBtn) {
            manualSyncBtn.addEventListener('click', () => {
                this.manualSyncToFirebase();
            });
        }

        // Close modal when clicking outside
        if (settingsModal) {
            window.addEventListener('click', (event) => {
                if (event.target === settingsModal) {
                    settingsModal.style.display = 'none';
                }
            });
        }
    }

    setupTabNavigation() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        const container = document.querySelector('.container');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');

                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));

                btn.classList.add('active');
                document.getElementById(targetTab + 'Tab').classList.add('active');

                // Add class to container for wider view on weigh-ins tab
                if (container) {
                    if (targetTab === 'weighIns') {
                        container.classList.add('weigh-ins-view');
                    } else {
                        container.classList.remove('weigh-ins-view');
                    }
                }

                // Refresh data when switching tabs
                if (targetTab === 'weighIns') {
                    this.renderPeriods();
                    if (this.currentPeriodId) {
                        this.renderWeighIns();
                    }
                } else if (targetTab === 'progress') {
                    this.updateAthleteSelects();
                    // Clear progress if athlete is from different gender
                    const selectedAthleteId = document.getElementById('progressAthleteSelect').value;
                    if (selectedAthleteId) {
                        const selectedAthlete = this.athletes.find(a => a.id === selectedAthleteId);
                        if (selectedAthlete && selectedAthlete.gender !== this.currentGender) {
                            document.getElementById('progressAthleteSelect').value = '';
                            document.getElementById('progressModal').style.display = 'none';
                        }
                    }
                }
            });
        });
    }

    setupAthletes() {
        document.getElementById('addAthleteBtn').addEventListener('click', () => {
            this.openAthleteModal();
        });
        
        // Search functionality
        const searchInput = document.getElementById('athleteSearchInput');
        searchInput.addEventListener('input', (e) => {
            this.filterAthletes(e.target.value);
        });
    }

    setupGenderToggle() {
        const genderToggleBtn = document.getElementById('genderToggleBtn');
        if (genderToggleBtn) {
            genderToggleBtn.addEventListener('click', () => {
                this.currentGender = this.currentGender === 'Boy' ? 'Girl' : 'Boy';
                this.updateGenderToggleButton();
                
                // Switch to Athletes tab by default
                this.showTab('athletes');
                
                // Clear search input and refresh athletes
                const searchInput = document.getElementById('athleteSearchInput');
                if (searchInput) {
                    searchInput.value = '';
                }
                // Update class filter dropdown for new gender
                this.updateClassFilter();
                this.renderAthletes();
                
                // Refresh periods (will filter by gender and clear period if needed)
                this.renderPeriods();
                
                // Refresh weigh-ins (will show empty state if no period selected)
                this.renderWeighIns();
                
                // Refresh progress tab if needed
                this.updateAthleteSelects();
                const selectedAthleteId = document.getElementById('progressAthleteSelect').value;
                if (selectedAthleteId) {
                    const selectedAthlete = this.athletes.find(a => a.id === selectedAthleteId);
                    if (selectedAthlete && selectedAthlete.gender !== this.currentGender) {
                        document.getElementById('progressAthleteSelect').value = '';
                        document.getElementById('progressModal').style.display = 'none';
                    }
                }
            });
        }
    }

    showTab(tabName) {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        const container = document.querySelector('.container');

        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (targetBtn) {
            targetBtn.classList.add('active');
            document.getElementById(tabName + 'Tab').classList.add('active');

            // Add class to container for wider view on weigh-ins tab
            if (container) {
                if (tabName === 'weighIns') {
                    container.classList.add('weigh-ins-view');
                } else {
                    container.classList.remove('weigh-ins-view');
                }
            }
        }
    }

    updateGenderToggleButton() {
        const genderToggleBtn = document.getElementById('genderToggleBtn');
        if (genderToggleBtn) {
            if (this.currentGender === 'Boy') {
                genderToggleBtn.textContent = 'Go to Girls';
            } else {
                genderToggleBtn.textContent = 'Go to Boys';
            }
        }
    }

    setupClassFilter() {
        const classFilterSelect = document.getElementById('classFilterSelect');
        if (classFilterSelect) {
            classFilterSelect.addEventListener('change', (e) => {
                const selectedValue = e.target.value;
                this.currentClassFilter = selectedValue === '' ? null : selectedValue;
                this.renderAthletes();
            });
        }
    }

    async updateClassFilter() {
        const classFilterSelect = document.getElementById('classFilterSelect');
        if (!classFilterSelect) return;

        // Get all unique class values from athletes of current gender
        await this.getAllAthletes();
        const genderFilteredAthletes = this.athletes.filter(a => a.gender === this.currentGender);
        const uniqueClasses = new Set();
        
        genderFilteredAthletes.forEach(athlete => {
            if (athlete.classOf) {
                uniqueClasses.add(athlete.classOf.toString());
            }
        });

        // Sort classes numerically (lowest to highest)
        const sortedClasses = Array.from(uniqueClasses).sort((a, b) => parseInt(a) - parseInt(b));

        // Clear existing options
        classFilterSelect.innerHTML = '';

        // Add "All Classes" option
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'All Classes';
        classFilterSelect.appendChild(allOption);

        // Add class options
        sortedClasses.forEach(classYear => {
            const option = document.createElement('option');
            option.value = classYear;
            option.textContent = `Class of ${classYear}`;
            classFilterSelect.appendChild(option);
        });

        // Set default to lowest class if not already set, or if current selection is no longer valid
        if (this.currentClassFilter === null || !sortedClasses.includes(this.currentClassFilter.toString())) {
            if (sortedClasses.length > 0) {
                this.currentClassFilter = sortedClasses[0];
                classFilterSelect.value = sortedClasses[0];
            } else {
                this.currentClassFilter = null;
                classFilterSelect.value = '';
            }
        } else {
            classFilterSelect.value = this.currentClassFilter.toString();
        }
    }

    setupWeighIns() {
        // Weigh ins are now displayed as a comparative table of all players
        // No add button needed
    }

    setupPeriods() {
        // Add period button will be created dynamically in renderPeriods
    }

    setupProgress() {
        document.getElementById('progressAthleteSelect').addEventListener('change', (e) => {
            const athleteId = e.target.value;
            if (athleteId) {
                const athlete = this.athletes.find(a => a.id === athleteId);
                if (athlete) {
                    document.getElementById('progressModalTitle').textContent = `${athlete.name} - Progress Charts`;
                    document.getElementById('progressModal').style.display = 'block';
                    this.renderProgress(athleteId);
                }
            }
        });

        // Close progress modal
        document.getElementById('closeProgressModal').addEventListener('click', () => {
            document.getElementById('progressModal').style.display = 'none';
        });

        // Close modal when clicking outside
        const progressModal = document.getElementById('progressModal');
        window.addEventListener('click', (e) => {
            if (e.target === progressModal) {
                progressModal.style.display = 'none';
            }
        });
    }

    setupModals() {
        // Populate Class of dropdown
        this.populateClassOfDropdown();
        
        // Athlete Modal
        const athleteModal = document.getElementById('athleteModal');
        document.getElementById('closeAthleteModal').addEventListener('click', () => {
            athleteModal.style.display = 'none';
        });
        document.getElementById('athleteForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveAthlete();
        });
        
        // Delete athlete button
        document.getElementById('deleteAthleteBtn').addEventListener('click', () => {
            if (this.editingAthleteId) {
                this.deleteAthleteHandler(this.editingAthleteId);
            }
        });

        // Athlete Profile Modal
        const athleteProfileModal = document.getElementById('athleteProfileModal');
        document.getElementById('closeAthleteProfileModal').addEventListener('click', () => {
            athleteProfileModal.style.display = 'none';
        });
        document.getElementById('editAthleteFromProfileBtn').addEventListener('click', () => {
            if (this.viewingAthleteId) {
                athleteProfileModal.style.display = 'none';
                this.openAthleteModal(this.viewingAthleteId);
            }
        });
        
        // Athlete Lifts Form
        document.getElementById('athleteLiftsForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveAthleteLiftsData();
        });

        // Period Modal
        const periodModal = document.getElementById('periodModal');
        document.getElementById('closePeriodModal').addEventListener('click', () => {
            periodModal.style.display = 'none';
        });
        document.getElementById('periodForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.savePeriod();
        });

        // Weigh In Modal
        const weighInModal = document.getElementById('weighInModal');
        document.getElementById('closeWeighInModal').addEventListener('click', () => {
            weighInModal.style.display = 'none';
        });
        document.getElementById('weighInForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveWeighIn();
        });

        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === athleteModal) {
                athleteModal.style.display = 'none';
            }
            if (e.target === periodModal) {
                periodModal.style.display = 'none';
            }
            if (e.target === weighInModal) {
                weighInModal.style.display = 'none';
            }
            if (e.target === athleteProfileModal) {
                athleteProfileModal.style.display = 'none';
            }
        });
    }

    populateClassOfDropdown() {
        const select = document.getElementById('athleteClassOfInput');
        if (!select) return;
        
        const currentYear = new Date().getFullYear();
        const startYear = 2025;
        const endYear = currentYear + 10; // 10 years in the future
        
        // Clear existing options (keep the default "-- Select Year --")
        select.innerHTML = '<option value="">-- Select Year --</option>';
        
        // Add years from 2025 to endYear
        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = year.toString();
            option.textContent = year.toString();
            select.appendChild(option);
        }
    }

    updateAthleteSelects() {
        const select = document.getElementById('progressAthleteSelect');
        if (select) {
            select.innerHTML = '<option value="">-- Select Athlete --</option>';
            // Filter athletes by current gender
            const genderFilteredAthletes = this.athletes.filter(a => a.gender === this.currentGender);
            genderFilteredAthletes.forEach(athlete => {
                const option = document.createElement('option');
                option.value = athlete.id;
                option.textContent = athlete.name;
                select.appendChild(option);
            });
        }
    }

    async renderAthletes(searchTerm = '') {
        await this.getAllAthletes();
        this.filterAthletes(searchTerm);
    }

    filterAthletes(searchTerm = '') {
        const athletesList = document.getElementById('athletesList');
        const emptyState = document.getElementById('emptyAthletesState');

        athletesList.innerHTML = '';

        athletesList.style.display = 'block';

        // Filter athletes by current gender first
        let filteredAthletes = this.athletes.filter(athlete => 
            athlete.gender === this.currentGender
        );

        // Filter by class if class filter is set
        if (this.currentClassFilter !== null) {
            filteredAthletes = filteredAthletes.filter(athlete =>
                athlete.classOf && athlete.classOf.toString() === this.currentClassFilter.toString()
            );
        }

        // Then filter by search term if provided
        if (searchTerm.trim()) {
            const search = searchTerm.toLowerCase();
            filteredAthletes = filteredAthletes.filter(athlete =>
                athlete.name.toLowerCase().includes(search) ||
                (athlete.classOf && athlete.classOf.toString().includes(search))
            );
        }

        if (filteredAthletes.length === 0) {
            emptyState.style.display = 'block';
            if (searchTerm.trim()) {
                emptyState.innerHTML = `
                    <p>🔍 No athletes found matching "${searchTerm}"</p>
                    <p>Try a different search term</p>
                `;
            } else {
                emptyState.innerHTML = `
                    <p>No ${this.currentGender.toLowerCase()} athletes found</p>
                    <p>Add a new athlete to get started</p>
                `;
            }
            athletesList.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';

        filteredAthletes.sort((a, b) => a.name.localeCompare(b.name));

        filteredAthletes.forEach(athlete => {
            const athleteCard = document.createElement('div');
            athleteCard.className = 'athlete-card';
            athleteCard.innerHTML = `
                <div class="athlete-name">${athlete.name}</div>
                <div class="athlete-meta">
                    ${athlete.classOf ? `<span>Class of ${athlete.classOf}</span>` : ''}
                </div>
            `;
            athleteCard.addEventListener('click', () => {
                this.openAthleteProfile(athlete.id);
            });
            athletesList.appendChild(athleteCard);
        });
    }

    async renderPeriods() {
        await this.getAllPeriods();
        const periodTabs = document.getElementById('periodTabs');
        periodTabs.innerHTML = '';

        // Filter periods by current gender
        const genderFilteredPeriods = this.periods.filter(p => p.gender === this.currentGender);
        
        // Clear current period if it doesn't match current gender
        if (this.currentPeriodId) {
            const currentPeriod = this.periods.find(p => p.id === this.currentPeriodId);
            if (!currentPeriod || currentPeriod.gender !== this.currentGender) {
                this.currentPeriodId = null;
            }
        }

        // Add period button
        const addPeriodBtn = document.createElement('button');
        addPeriodBtn.className = 'btn btn-secondary period-tab';
        addPeriodBtn.style.cssText = 'padding: 8px 16px; font-size: 14px; white-space: nowrap; min-width: 50px;';
        addPeriodBtn.textContent = '+';
        addPeriodBtn.addEventListener('click', () => {
            this.openPeriodModal();
        });
        periodTabs.appendChild(addPeriodBtn);

        // Add period tabs (filtered by gender)
        genderFilteredPeriods.forEach(period => {
            const periodTabContainer = document.createElement('div');
            periodTabContainer.style.cssText = 'position: relative; display: inline-block;';
            
            const periodTab = document.createElement('button');
            periodTab.className = 'btn btn-secondary period-tab';
            periodTab.style.cssText = 'padding: 8px 16px; font-size: 14px; white-space: nowrap;';
            if (this.currentPeriodId === period.id) {
                periodTab.classList.add('active');
                periodTab.style.background = 'var(--primary-color)';
                periodTab.style.color = 'white';
            }
            periodTab.textContent = period.name;
            periodTab.addEventListener('click', () => {
                this.currentPeriodId = period.id;
                this.renderPeriods();
                this.renderWeighIns();
            });
            
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '×';
            deleteBtn.style.cssText = 'position: absolute; top: 2px; right: 2px; background: rgba(255, 255, 255, 0.9); color: #000; border: none; width: 12px; height: 12px; font-size: 10px; line-height: 1; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; font-weight: bold; transition: all 0.2s; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2);';
            deleteBtn.title = 'Delete period';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete "${period.name}"? This will also delete all weigh-ins and athlete data for this period.`)) {
                    this.deletePeriodHandler(period.id);
                }
            });
            deleteBtn.addEventListener('mouseenter', () => {
                deleteBtn.style.background = 'var(--danger-color)';
                deleteBtn.style.color = 'white';
                deleteBtn.style.transform = 'scale(1.1)';
            });
            deleteBtn.addEventListener('mouseleave', () => {
                deleteBtn.style.background = 'rgba(255, 255, 255, 0.9)';
                deleteBtn.style.color = '#000';
                deleteBtn.style.transform = 'scale(1)';
            });
            
            periodTabContainer.appendChild(periodTab);
            periodTabContainer.appendChild(deleteBtn);
            periodTabs.appendChild(periodTabContainer);
        });

        // No auto-selection - user must select a period or create one
    }

    async renderWeighIns() {
        if (!this.currentPeriodId) {
            const weighInsList = document.getElementById('weighInsList');
            const emptyState = document.getElementById('emptyWeighInState');
            weighInsList.innerHTML = '';
            emptyState.style.display = 'block';
            emptyState.innerHTML = '<p>📊 Please select a period to view players\' weigh in information.</p>';
            return;
        }

        // Get all athletes and their lift data for the selected period
        await this.getAllAthletes();
        await this.getAllAthleteLifts();
        
        const weighInsList = document.getElementById('weighInsList');
        const emptyState = document.getElementById('emptyWeighInState');

        weighInsList.innerHTML = '';

        // Filter athlete lifts for current period
        const periodLifts = this.athleteLifts.filter(l => l.periodId === this.currentPeriodId);
        
        // Filter athletes by current gender
        let genderFilteredAthletes = this.athletes.filter(a => a.gender === this.currentGender);
        
        // Filter by class if class filter is set
        if (this.currentClassFilter !== null) {
            genderFilteredAthletes = genderFilteredAthletes.filter(athlete =>
                athlete.classOf && athlete.classOf.toString() === this.currentClassFilter.toString()
            );
        }
        
        if (genderFilteredAthletes.length === 0) {
            emptyState.style.display = 'block';
            emptyState.innerHTML = `<p>📊 No ${this.currentGender.toLowerCase()} athletes found. Add athletes first!</p>`;
            return;
        }

        emptyState.style.display = 'none';

        // Create a table to display all players' information
        const tableContainer = document.createElement('div');
        tableContainer.style.cssText = 'margin-top: 15px; width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;';
        
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; min-width: 1600px; border-collapse: collapse; background: var(--card-bg); border-radius: 12px; overflow: hidden;';
        
        // Create header row
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'background: var(--primary-color); color: white;';
        
        const headers = [
            'Player', 'Class', 'Weight', 'Height', 
            'Bench', 'Dead', 'Squat', 'Clean', 'Incline',
            'Vert', 'Forty', 'Agility', 'Lift Rating'
        ];
        
        headers.forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            th.style.cssText = 'padding: 8px 6px; text-align: left; font-weight: 600; font-size: 13px; white-space: nowrap; cursor: pointer; user-select: none; position: relative;';
            
            // Add sort indicator
            if (this.weighInsSortColumn === header) {
                const sortIndicator = document.createElement('span');
                sortIndicator.textContent = this.weighInsSortDirection === 'asc' ? ' ▲' : ' ▼';
                sortIndicator.style.cssText = 'font-size: 10px; opacity: 0.9;';
                th.appendChild(sortIndicator);
                th.style.cssText += 'background: rgba(255, 255, 255, 0.2);';
            }
            
            // Add hover effect
            th.addEventListener('mouseenter', () => {
                th.style.background = 'rgba(255, 255, 255, 0.25)';
            });
            th.addEventListener('mouseleave', () => {
                if (this.weighInsSortColumn === header) {
                    th.style.background = 'rgba(255, 255, 255, 0.2)';
                } else {
                    th.style.background = '';
                }
            });
            
            // Add click handler for sorting
            th.addEventListener('click', () => {
                if (this.weighInsSortColumn === header) {
                    // Toggle direction if same column
                    this.weighInsSortDirection = this.weighInsSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    // New column, default to ascending
                    this.weighInsSortColumn = header;
                    this.weighInsSortDirection = 'asc';
                }
                this.renderWeighIns();
            });
            
            headerRow.appendChild(th);
        });
        
        table.appendChild(headerRow);
        
        // Prepare athlete data with their lift data for sorting
        const athletesWithData = genderFilteredAthletes.map(athlete => {
            const athleteLiftData = periodLifts.find(l => l.athleteId === athlete.id);
            return {
                athlete,
                athleteLiftData
            };
        });
        
        // Sort athletes based on current sort column and direction
        const sortedAthletesWithData = this.sortAthletesForWeighIns(athletesWithData, periodLifts);
        
        // Create data rows for each athlete
        sortedAthletesWithData.forEach(({ athlete, athleteLiftData }) => {
            const row = document.createElement('tr');
            row.style.cssText = 'border-bottom: 1px solid var(--border-color);';
            
            // Helper function to format values
            const formatValue = (value, unit = '') => {
                if (value === undefined || value === null || value === '') return '--';
                return `${value}${unit ? ' ' + unit : ''}`;
            };
            
            // Calculate ratio for weight lifts if weight exists
            const getWeightLiftDisplay = (liftId) => {
                if (!athleteLiftData || !athleteLiftData[liftId]) return '--';
                const liftValue = athleteLiftData[liftId];
                const weightValue = athleteLiftData.weight;
                if (weightValue && weightValue > 0) {
                    const ratio = (liftValue / weightValue).toFixed(2);
                    return `${liftValue} lbs (${ratio}x)`;
                }
                return `${liftValue} lbs`;
            };
            
            // Calculate lift rating (average of weight-to-bodyweight ratios)
            const calculateLiftRating = () => {
                if (!athleteLiftData || !athleteLiftData.weight || athleteLiftData.weight <= 0) {
                    return '--';
                }
                const weightValue = athleteLiftData.weight;
                const weightLiftIds = ['bench', 'dead', 'squat', 'clean', 'incline'];
                const ratios = [];
                
                weightLiftIds.forEach(liftId => {
                    if (athleteLiftData[liftId] && athleteLiftData[liftId] > 0) {
                        const ratio = parseFloat(athleteLiftData[liftId]) / weightValue;
                        ratios.push(ratio);
                    }
                });
                
                if (ratios.length > 0) {
                    const average = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
                    return `${average.toFixed(2)}x`;
                }
                return '--';
            };
            
            const cells = [
                athlete.name,
                athlete.classOf ? athlete.classOf.toString() : '--',
                formatValue(athleteLiftData?.weight, 'lbs'),
                formatValue(athleteLiftData?.height, 'in'),
                getWeightLiftDisplay('bench'),
                getWeightLiftDisplay('dead'),
                getWeightLiftDisplay('squat'),
                getWeightLiftDisplay('clean'),
                getWeightLiftDisplay('incline'),
                formatValue(athleteLiftData?.vert, 'in'),
                formatValue(athleteLiftData?.forty, 's'),
                formatValue(athleteLiftData?.agility, 's'),
                calculateLiftRating()
            ];
            
            cells.forEach((cellText, index) => {
                const td = document.createElement('td');
                td.textContent = cellText;
                td.style.cssText = 'padding: 8px 6px; font-size: 13px; color: var(--text-primary); white-space: nowrap;';
                
                // Make player name clickable to open profile
                if (index === 0) {
                    td.style.cssText += 'cursor: pointer; font-weight: 600; color: var(--primary-color);';
                    td.addEventListener('click', () => {
                        this.openAthleteProfile(athlete.id);
                    });
                    td.title = 'Click to view/edit player profile';
                }
                
                // Style the Lift Rating column
                if (index === cells.length - 1) {
                    td.style.cssText += 'font-weight: 700; color: var(--primary-color); font-size: 14px;';
                }
                
                row.appendChild(td);
            });
            
            table.appendChild(row);
        });
        
        tableContainer.appendChild(table);
        weighInsList.appendChild(tableContainer);
        
        // Add a note about clicking player names
        const note = document.createElement('p');
        note.style.cssText = 'margin-top: 15px; font-size: 12px; color: var(--text-secondary); text-align: center;';
        note.textContent = '💡 Click on a player\'s name to view and edit their profile • Click column headers to sort';
        weighInsList.appendChild(note);
    }

    sortAthletesForWeighIns(athletesWithData, periodLifts) {
        const sorted = [...athletesWithData];
        const direction = this.weighInsSortDirection === 'asc' ? 1 : -1;
        
        sorted.sort((a, b) => {
            let valueA, valueB;
            
            switch (this.weighInsSortColumn) {
                case 'Player':
                    valueA = a.athlete.name.toLowerCase();
                    valueB = b.athlete.name.toLowerCase();
                    return direction * valueA.localeCompare(valueB);
                
                case 'Class':
                    valueA = a.athlete.classOf || 0;
                    valueB = b.athlete.classOf || 0;
                    return direction * (valueA - valueB);
                
                case 'Weight':
                    valueA = a.athleteLiftData?.weight || 0;
                    valueB = b.athleteLiftData?.weight || 0;
                    return direction * (valueA - valueB);
                
                case 'Height':
                    valueA = a.athleteLiftData?.height || 0;
                    valueB = b.athleteLiftData?.height || 0;
                    return direction * (valueA - valueB);
                
                case 'Bench':
                case 'Dead':
                case 'Squat':
                case 'Clean':
                case 'Incline':
                    const liftId = this.weighInsSortColumn.toLowerCase();
                    valueA = a.athleteLiftData?.[liftId] || 0;
                    valueB = b.athleteLiftData?.[liftId] || 0;
                    return direction * (valueA - valueB);
                
                case 'Vert':
                    valueA = a.athleteLiftData?.vert || 0;
                    valueB = b.athleteLiftData?.vert || 0;
                    return direction * (valueA - valueB);
                
                case 'Forty':
                    valueA = a.athleteLiftData?.forty || 0;
                    valueB = b.athleteLiftData?.forty || 0;
                    // Lower is better for Forty, so reverse direction
                    return -direction * (valueA - valueB);
                
                case 'Agility':
                    valueA = a.athleteLiftData?.agility || 0;
                    valueB = b.athleteLiftData?.agility || 0;
                    // Lower is better for Agility, so reverse direction
                    return -direction * (valueA - valueB);
                
                case 'Lift Rating':
                    // Calculate lift rating for comparison
                    const calculateRating = (athleteLiftData) => {
                        if (!athleteLiftData || !athleteLiftData.weight || athleteLiftData.weight <= 0) {
                            return 0;
                        }
                        const weightValue = athleteLiftData.weight;
                        const weightLiftIds = ['bench', 'dead', 'squat', 'clean', 'incline'];
                        const ratios = [];
                        
                        weightLiftIds.forEach(liftId => {
                            if (athleteLiftData[liftId] && athleteLiftData[liftId] > 0) {
                                const ratio = parseFloat(athleteLiftData[liftId]) / weightValue;
                                ratios.push(ratio);
                            }
                        });
                        
                        if (ratios.length > 0) {
                            return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
                        }
                        return 0;
                    };
                    
                    valueA = calculateRating(a.athleteLiftData);
                    valueB = calculateRating(b.athleteLiftData);
                    return direction * (valueA - valueB);
                
                default:
                    return 0;
            }
        });
        
        return sorted;
    }

    async renderProgress(athleteId) {
        // Check if Chart.js is loaded
        if (typeof Chart === 'undefined') {
            const graphsContainer = document.querySelector('.progress-graphs-container');
            if (graphsContainer) {
                graphsContainer.innerHTML = '<p class="empty-state" style="text-align: center; padding: 40px; color: var(--text-secondary);">Loading charts...</p>';
            }
            // Wait a bit and try again
            setTimeout(() => this.renderProgress(athleteId), 500);
            return;
        }

        // Make sure modal is open
        const progressModal = document.getElementById('progressModal');
        if (progressModal) {
            progressModal.style.display = 'block';
        }

        // Destroy existing charts if they exist
        if (this.progressCharts.lifts) {
            this.progressCharts.lifts.destroy();
            this.progressCharts.lifts = null;
        }
        if (this.progressCharts.runs) {
            this.progressCharts.runs.destroy();
            this.progressCharts.runs = null;
        }
        if (this.progressCharts.rating) {
            this.progressCharts.rating.destroy();
            this.progressCharts.rating = null;
        }
        if (this.progressCharts.vert) {
            this.progressCharts.vert.destroy();
            this.progressCharts.vert = null;
        }

        // Get all periods and athlete lifts
        await this.getAllPeriods();
        await this.getAllAthleteLifts();
        
        // Get all lifts for this athlete, sorted by period
        const athleteLifts = this.athleteLifts.filter(l => l.athleteId === athleteId);
        
        if (athleteLifts.length === 0) {
            const graphsContainer = document.querySelector('.progress-graphs-container');
            if (graphsContainer) {
                graphsContainer.innerHTML = '<p class="empty-state" style="text-align: center; padding: 40px; color: var(--text-secondary);">No data yet for this athlete. Add lift data in their profile.</p>';
            }
            return;
        }

        // Make sure the graph container structure is intact
        const graphsContainer = document.querySelector('.progress-graphs-container');
        if (!graphsContainer || !graphsContainer.querySelector('#liftsChart')) {
            const progressModalContent = document.querySelector('#progressModal .modal-content');
            const existingContainer = progressModalContent.querySelector('.progress-graphs-container');
            if (existingContainer) {
                existingContainer.innerHTML = `
                    <div class="progress-graph-card">
                        <h3 style="margin-bottom: 15px; color: var(--text-primary); font-size: 20px; font-weight: 600;">Weight Lifts Progress</h3>
                        <canvas id="liftsChart"></canvas>
                        <div id="weightLiftsTable" style="margin-top: 15px; overflow-x: auto;"></div>
                    </div>
                    <div class="progress-graph-card">
                        <h3 style="margin-bottom: 15px; color: var(--text-primary); font-size: 20px; font-weight: 600;">Lift Rating Progress</h3>
                        <canvas id="ratingChart"></canvas>
                    </div>
                    <div class="progress-graph-card">
                        <h3 style="margin-bottom: 15px; color: var(--text-primary); font-size: 20px; font-weight: 600;">Running Exercises Progress</h3>
                        <canvas id="runsChart"></canvas>
                        <div id="runsTable" style="margin-top: 15px; overflow-x: auto;"></div>
                    </div>
                    <div class="progress-graph-card">
                        <h3 style="margin-bottom: 15px; color: var(--text-primary); font-size: 20px; font-weight: 600;">Vertical (VERT) Progress</h3>
                        <canvas id="vertChart"></canvas>
                        <div id="vertTable" style="margin-top: 15px; overflow-x: auto;"></div>
                    </div>
                `;
            }
        }

        // Sort periods by creation date or name
        const periodsWithData = [];
        athleteLifts.forEach(lift => {
            const period = this.periods.find(p => p.id === lift.periodId);
            if (period) {
                periodsWithData.push({
                    period: period,
                    lift: lift
                });
            }
        });

        // Sort by period name (assuming chronological naming) or creation date
        periodsWithData.sort((a, b) => {
            if (a.period.createdAt && b.period.createdAt) {
                return new Date(a.period.createdAt) - new Date(b.period.createdAt);
            }
            return a.period.name.localeCompare(b.period.name);
        });

        const labels = periodsWithData.map(p => p.period.name);
        
        // Weight lifts data (Bench, Dead, Squat, Clean, Incline)
        const weightLifts = ['bench', 'dead', 'squat', 'clean', 'incline'];
        const weightLiftColors = ['#4169E1', '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3'];
        const weightLiftNames = ['Bench', 'Dead', 'Squat', 'Clean', 'Incline'];
        
        const weightLiftDatasets = weightLifts.map((liftId, index) => ({
            label: weightLiftNames[index],
            data: periodsWithData.map(p => p.lift[liftId] || null),
            borderColor: weightLiftColors[index],
            backgroundColor: weightLiftColors[index] + '40',
            tension: 0.4,
            fill: false
        }));

        // Running exercises data (Vert, Forty, Agility)
        const runs = ['vert', 'forty', 'agility'];
        const runColors = ['#9B59B6', '#E67E22', '#1ABC9C'];
        const runNames = ['Vert (inches)', 'Forty (seconds)', 'Agility (seconds)'];
        
        const runDatasets = runs.map((runId, index) => ({
            label: runNames[index],
            data: periodsWithData.map(p => p.lift[runId] || null),
            borderColor: runColors[index],
            backgroundColor: runColors[index] + '40',
            tension: 0.4,
            fill: false
        }));

        // Calculate lift rating over time
        const ratingData = periodsWithData.map(p => {
            const lift = p.lift;
            if (!lift.weight || lift.weight <= 0) return null;
            
            const ratios = [];
            weightLifts.forEach(liftId => {
                if (lift[liftId] && lift[liftId] > 0) {
                    ratios.push(lift[liftId] / lift.weight);
                }
            });
            
            if (ratios.length > 0) {
                return parseFloat((ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length).toFixed(2));
            }
            return null;
        });

        // Create charts in order: Weight Lifts, Lift Rating, Running Exercises
        const liftsCtx = document.getElementById('liftsChart').getContext('2d');
        this.progressCharts.lifts = new Chart(liftsCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: weightLiftDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Weight (lbs)'
                        }
                    }
                }
            }
        });

        const ratingCtx = document.getElementById('ratingChart').getContext('2d');
        this.progressCharts.rating = new Chart(ratingCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Lift Rating (x bodyweight)',
                    data: ratingData,
                    borderColor: '#4169E1',
                    backgroundColor: '#4169E140',
                    tension: 0.4,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Rating (x)'
                        }
                    }
                }
            }
        });

        const runsCtx = document.getElementById('runsChart').getContext('2d');
        this.progressCharts.runs = new Chart(runsCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: runDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Value'
                        }
                    }
                }
            }
        });

        // Create VERT chart
        const vertData = periodsWithData.map(p => p.lift.vert || null);
        const vertCtx = document.getElementById('vertChart').getContext('2d');
        this.progressCharts.vert = new Chart(vertCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Vertical (inches)',
                    data: vertData,
                    borderColor: '#9B59B6',
                    backgroundColor: '#9B59B640',
                    tension: 0.4,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Vertical (inches)'
                        }
                    }
                }
            }
        });

        // Render progress tables
        this.renderWeightLiftsTable(periodsWithData);
        this.renderRunsTable(periodsWithData);
        this.renderVertTable(periodsWithData);
    }

    renderWeightLiftsTable(periodsWithData) {
        const tableContainer = document.getElementById('weightLiftsTable');
        if (!tableContainer) return;

        if (periodsWithData.length === 0) {
            tableContainer.innerHTML = '';
            return;
        }

        // Weight lifts categories
        const weightLifts = [
            { id: 'bench', name: 'Bench', unit: 'lbs' },
            { id: 'dead', name: 'Dead', unit: 'lbs' },
            { id: 'squat', name: 'Squat', unit: 'lbs' },
            { id: 'clean', name: 'Clean', unit: 'lbs' },
            { id: 'incline', name: 'Incline', unit: 'lbs' }
        ];

        // Create table
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); font-size: 13px;';
        
        // Create header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'background: var(--primary-color); color: white;';
        
        const categoryHeader = document.createElement('th');
        categoryHeader.textContent = 'Lift';
        categoryHeader.style.cssText = 'padding: 8px 12px; text-align: left; font-weight: 600; font-size: 12px;';
        headerRow.appendChild(categoryHeader);

        periodsWithData.forEach((periodData) => {
            const periodHeader = document.createElement('th');
            periodHeader.textContent = periodData.period.name;
            periodHeader.style.cssText = 'padding: 8px 12px; text-align: center; font-weight: 600; font-size: 12px; white-space: nowrap;';
            headerRow.appendChild(periodHeader);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');

        weightLifts.forEach((lift, index) => {
            const row = document.createElement('tr');
            row.style.cssText = 'border-bottom: 1px solid var(--border-color);';
            
            const liftCell = document.createElement('td');
            liftCell.textContent = lift.name;
            liftCell.style.cssText = 'padding: 8px 12px; font-weight: 600; color: var(--text-primary); font-size: 12px;';
            row.appendChild(liftCell);

            periodsWithData.forEach((periodData, periodIndex) => {
                const liftData = periodData.lift;
                const cell = document.createElement('td');
                cell.style.cssText = 'padding: 8px 12px; text-align: center; font-size: 12px;';
                
                const value = liftData[lift.id];
                if (value && value > 0) {
                    cell.textContent = value + ' ' + lift.unit;
                    cell.style.color = 'var(--text-primary)';
                    
                    // Show change from previous period
                    if (periodIndex > 0) {
                        const prevLiftData = periodsWithData[periodIndex - 1].lift;
                        const prevValue = prevLiftData[lift.id];
                        if (prevValue && prevValue > 0) {
                            const change = value - prevValue;
                            if (change !== 0) {
                                const changeSpan = document.createElement('span');
                                changeSpan.style.cssText = `display: block; font-size: 10px; margin-top: 2px; color: ${change > 0 ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: 500;`;
                                changeSpan.textContent = (change > 0 ? '+' : '') + change.toFixed(0) + ' ' + lift.unit;
                                cell.appendChild(changeSpan);
                            }
                        }
                    }
                } else {
                    cell.textContent = '--';
                    cell.style.color = 'var(--text-secondary)';
                }
                
                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableContainer.innerHTML = '';
        tableContainer.appendChild(table);
    }

    renderRunsTable(periodsWithData) {
        const tableContainer = document.getElementById('runsTable');
        if (!tableContainer) return;

        if (periodsWithData.length === 0) {
            tableContainer.innerHTML = '';
            return;
        }

        // Running exercises categories
        const runs = [
            { id: 'vert', name: 'Vert', unit: 'inches' },
            { id: 'forty', name: 'Forty', unit: 'seconds' },
            { id: 'agility', name: 'Agility', unit: 'seconds' }
        ];

        // Create table
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); font-size: 13px;';
        
        // Create header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'background: var(--primary-color); color: white;';
        
        const categoryHeader = document.createElement('th');
        categoryHeader.textContent = 'Exercise';
        categoryHeader.style.cssText = 'padding: 8px 12px; text-align: left; font-weight: 600; font-size: 12px;';
        headerRow.appendChild(categoryHeader);

        periodsWithData.forEach((periodData) => {
            const periodHeader = document.createElement('th');
            periodHeader.textContent = periodData.period.name;
            periodHeader.style.cssText = 'padding: 8px 12px; text-align: center; font-weight: 600; font-size: 12px; white-space: nowrap;';
            headerRow.appendChild(periodHeader);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');

        runs.forEach((run, index) => {
            const row = document.createElement('tr');
            row.style.cssText = 'border-bottom: 1px solid var(--border-color);';
            
            const runCell = document.createElement('td');
            runCell.textContent = run.name;
            runCell.style.cssText = 'padding: 8px 12px; font-weight: 600; color: var(--text-primary); font-size: 12px;';
            row.appendChild(runCell);

            periodsWithData.forEach((periodData, periodIndex) => {
                const liftData = periodData.lift;
                const cell = document.createElement('td');
                cell.style.cssText = 'padding: 8px 12px; text-align: center; font-size: 12px;';
                
                const value = liftData[run.id];
                if (value && value > 0) {
                    cell.textContent = value + ' ' + run.unit;
                    cell.style.color = 'var(--text-primary)';
                    
                    // Show change from previous period
                    // For runs: lower is better (except vert where higher is better)
                    if (periodIndex > 0) {
                        const prevLiftData = periodsWithData[periodIndex - 1].lift;
                        const prevValue = prevLiftData[run.id];
                        if (prevValue && prevValue > 0) {
                            const change = value - prevValue;
                            if (change !== 0) {
                                const changeSpan = document.createElement('span');
                                // For vert: increase is good, for forty/agility: decrease is good
                                const isImprovement = (run.id === 'vert' && change > 0) || (run.id !== 'vert' && change < 0);
                                changeSpan.style.cssText = `display: block; font-size: 10px; margin-top: 2px; color: ${isImprovement ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: 500;`;
                                changeSpan.textContent = (change > 0 ? '+' : '') + change.toFixed(2) + ' ' + run.unit;
                                cell.appendChild(changeSpan);
                            }
                        }
                    }
                } else {
                    cell.textContent = '--';
                    cell.style.color = 'var(--text-secondary)';
                }
                
                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableContainer.innerHTML = '';
        tableContainer.appendChild(table);
    }

    renderVertTable(periodsWithData) {
        const tableContainer = document.getElementById('vertTable');
        if (!tableContainer) return;

        if (periodsWithData.length === 0) {
            tableContainer.innerHTML = '';
            return;
        }

        // Create table
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); font-size: 13px;';
        
        // Create header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'background: var(--primary-color); color: white;';
        
        const periodHeader = document.createElement('th');
        periodHeader.textContent = 'Period';
        periodHeader.style.cssText = 'padding: 8px 12px; text-align: left; font-weight: 600; font-size: 12px;';
        headerRow.appendChild(periodHeader);

        const valueHeader = document.createElement('th');
        valueHeader.textContent = 'Vertical (inches)';
        valueHeader.style.cssText = 'padding: 8px 12px; text-align: center; font-weight: 600; font-size: 12px;';
        headerRow.appendChild(valueHeader);

        const changeHeader = document.createElement('th');
        changeHeader.textContent = 'Change';
        changeHeader.style.cssText = 'padding: 8px 12px; text-align: center; font-weight: 600; font-size: 12px;';
        headerRow.appendChild(changeHeader);

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');

        periodsWithData.forEach((periodData, periodIndex) => {
            const row = document.createElement('tr');
            row.style.cssText = 'border-bottom: 1px solid var(--border-color);';
            
            const periodCell = document.createElement('td');
            periodCell.textContent = periodData.period.name;
            periodCell.style.cssText = 'padding: 8px 12px; font-weight: 600; color: var(--text-primary); font-size: 12px;';
            row.appendChild(periodCell);

            const valueCell = document.createElement('td');
            valueCell.style.cssText = 'padding: 8px 12px; text-align: center; font-size: 12px;';
            
            const value = periodData.lift.vert;
            if (value && value > 0) {
                valueCell.textContent = value + ' inches';
                valueCell.style.color = 'var(--text-primary)';
                valueCell.style.fontWeight = '600';
            } else {
                valueCell.textContent = '--';
                valueCell.style.color = 'var(--text-secondary)';
            }
            row.appendChild(valueCell);

            const changeCell = document.createElement('td');
            changeCell.style.cssText = 'padding: 8px 12px; text-align: center; font-size: 12px;';
            
            if (periodIndex > 0 && value && value > 0) {
                const prevLiftData = periodsWithData[periodIndex - 1].lift;
                const prevValue = prevLiftData.vert;
                if (prevValue && prevValue > 0) {
                    const change = value - prevValue;
                    if (change !== 0) {
                        changeCell.textContent = (change > 0 ? '+' : '') + change.toFixed(2) + ' inches';
                        changeCell.style.color = change > 0 ? 'var(--success-color)' : 'var(--danger-color)';
                        changeCell.style.fontWeight = '500';
                    } else {
                        changeCell.textContent = '--';
                        changeCell.style.color = 'var(--text-secondary)';
                    }
                } else {
                    changeCell.textContent = '--';
                    changeCell.style.color = 'var(--text-secondary)';
                }
            } else {
                changeCell.textContent = '--';
                changeCell.style.color = 'var(--text-secondary)';
            }
            row.appendChild(changeCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableContainer.innerHTML = '';
        tableContainer.appendChild(table);
    }

    renderProgressTable(athleteId, periodsWithData) {
        let tableContainer = document.getElementById('progressTable');
        
        // If table container doesn't exist, create it
        if (!tableContainer) {
            const progressModalContent = document.querySelector('#progressModal .modal-content');
            if (!progressModalContent) return;
            
            let tableContainerDiv = document.getElementById('progressTableContainer');
            if (!tableContainerDiv) {
                tableContainerDiv = document.createElement('div');
                tableContainerDiv.id = 'progressTableContainer';
                tableContainerDiv.style.cssText = 'margin-top: 30px;';
                tableContainerDiv.innerHTML = `
                    <h3 style="margin-bottom: 15px; color: var(--text-primary); font-size: 20px; font-weight: 600;">Progress Table</h3>
                    <div id="progressTable" style="overflow-x: auto;"></div>
                `;
                progressModalContent.appendChild(tableContainerDiv);
            }
            tableContainer = document.getElementById('progressTable');
            if (!tableContainer) return;
        }

        if (periodsWithData.length === 0) {
            tableContainer.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);">No data available</p>';
            return;
        }

        // Define all categories to display
        const categories = [
            { id: 'weight', name: 'Weight', unit: 'lbs', isWeight: true },
            { id: 'height', name: 'Height', unit: 'inches', isWeight: false },
            { id: 'bench', name: 'Bench', unit: 'lbs', isWeight: true },
            { id: 'dead', name: 'Dead', unit: 'lbs', isWeight: true },
            { id: 'squat', name: 'Squat', unit: 'lbs', isWeight: true },
            { id: 'clean', name: 'Clean', unit: 'lbs', isWeight: true },
            { id: 'incline', name: 'Incline', unit: 'lbs', isWeight: true },
            { id: 'vert', name: 'Vert', unit: 'inches', isWeight: false },
            { id: 'forty', name: 'Forty', unit: 'seconds', isWeight: false },
            { id: 'agility', name: 'Agility', unit: 'seconds', isWeight: false }
        ];

        // Create table
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow);';
        
        // Create header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'background: var(--primary-color); color: white;';
        
        const categoryHeader = document.createElement('th');
        categoryHeader.textContent = 'Category';
        categoryHeader.style.cssText = 'padding: 12px; text-align: left; font-weight: 600; font-size: 14px;';
        headerRow.appendChild(categoryHeader);

        periodsWithData.forEach((periodData, index) => {
            const periodHeader = document.createElement('th');
            periodHeader.textContent = periodData.period.name;
            periodHeader.style.cssText = 'padding: 12px; text-align: center; font-weight: 600; font-size: 14px; white-space: nowrap;';
            headerRow.appendChild(periodHeader);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');

        // Add Lift Rating row first (calculated value)
        const ratingRow = document.createElement('tr');
        ratingRow.style.cssText = 'border-bottom: 1px solid var(--border-color);';
        
        const ratingCategoryCell = document.createElement('td');
        ratingCategoryCell.textContent = 'Lift Rating';
        ratingCategoryCell.style.cssText = 'padding: 12px; font-weight: 600; color: var(--text-primary);';
        ratingRow.appendChild(ratingCategoryCell);

        periodsWithData.forEach((periodData, index) => {
            const lift = periodData.lift;
            const cell = document.createElement('td');
            cell.style.cssText = 'padding: 12px; text-align: center;';
            
            if (!lift.weight || lift.weight <= 0) {
                cell.textContent = '--';
                cell.style.color = 'var(--text-secondary)';
            } else {
                const weightLifts = ['bench', 'dead', 'squat', 'clean', 'incline'];
                const ratios = [];
                weightLifts.forEach(liftId => {
                    if (lift[liftId] && lift[liftId] > 0) {
                        ratios.push(lift[liftId] / lift.weight);
                    }
                });
                
                if (ratios.length > 0) {
                    const rating = parseFloat((ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length).toFixed(2));
                    cell.textContent = rating.toFixed(2) + 'x';
                    cell.style.color = 'var(--text-primary)';
                    cell.style.fontWeight = '600';
                    
                    // Show change from previous period
                    if (index > 0) {
                        const prevLift = periodsWithData[index - 1].lift;
                        if (prevLift.weight && prevLift.weight > 0) {
                            const prevRatios = [];
                            weightLifts.forEach(liftId => {
                                if (prevLift[liftId] && prevLift[liftId] > 0) {
                                    prevRatios.push(prevLift[liftId] / prevLift.weight);
                                }
                            });
                            if (prevRatios.length > 0) {
                                const prevRating = parseFloat((prevRatios.reduce((sum, ratio) => sum + ratio, 0) / prevRatios.length).toFixed(2));
                                const change = rating - prevRating;
                                if (change !== 0) {
                                    const changeSpan = document.createElement('span');
                                    changeSpan.style.cssText = `display: block; font-size: 11px; margin-top: 4px; color: ${change > 0 ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: 500;`;
                                    changeSpan.textContent = (change > 0 ? '+' : '') + change.toFixed(2);
                                    cell.appendChild(changeSpan);
                                }
                            }
                        }
                    }
                } else {
                    cell.textContent = '--';
                    cell.style.color = 'var(--text-secondary)';
                }
            }
            
            ratingRow.appendChild(cell);
        });

        tbody.appendChild(ratingRow);

        // Add rows for each category
        categories.forEach((category, categoryIndex) => {
            const row = document.createElement('tr');
            row.style.cssText = 'border-bottom: 1px solid var(--border-color);';
            
            // Use categoryIndex + 1 to account for the rating row already added
            if ((categoryIndex + 1) % 2 === 0) {
                row.style.background = 'var(--bg-color)';
            }
            
            const categoryCell = document.createElement('td');
            categoryCell.textContent = category.name;
            categoryCell.style.cssText = 'padding: 12px; font-weight: 600; color: var(--text-primary);';
            row.appendChild(categoryCell);

            periodsWithData.forEach((periodData, index) => {
                const lift = periodData.lift;
                const cell = document.createElement('td');
                cell.style.cssText = 'padding: 12px; text-align: center;';
                
                const value = lift[category.id];
                if (value && value > 0) {
                    cell.textContent = value + ' ' + category.unit;
                    cell.style.color = 'var(--text-primary)';
                    
                    // Show change from previous period
                    if (index > 0) {
                        const prevLift = periodsWithData[index - 1].lift;
                        const prevValue = prevLift[category.id];
                        if (prevValue && prevValue > 0) {
                            const change = value - prevValue;
                            if (change !== 0) {
                                const changeSpan = document.createElement('span');
                                changeSpan.style.cssText = `display: block; font-size: 11px; margin-top: 4px; color: ${(change > 0 && category.isWeight) || (change < 0 && !category.isWeight) ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: 500;`;
                                changeSpan.textContent = (change > 0 ? '+' : '') + change.toFixed(category.isWeight ? 0 : 2) + ' ' + category.unit;
                                cell.appendChild(changeSpan);
                            }
                        }
                    }
                } else {
                    cell.textContent = '--';
                    cell.style.color = 'var(--text-secondary)';
                }
                
                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableContainer.innerHTML = '';
        tableContainer.appendChild(table);
        
        // Ensure the container is visible
        const tableContainerDiv = document.getElementById('progressTableContainer');
        if (tableContainerDiv) {
            tableContainerDiv.style.display = 'block';
        }
    }

    async openAthleteProfile(athleteId) {
        this.viewingAthleteId = athleteId;
        const athlete = this.athletes.find(a => a.id === athleteId);
        if (!athlete) return;

        const modal = document.getElementById('athleteProfileModal');
        const profileName = document.getElementById('athleteProfileName');
        const profileClass = document.getElementById('athleteProfileClass');

        // Set athlete info
        profileName.textContent = athlete.name;
        profileClass.textContent = athlete.classOf ? `Class of ${athlete.classOf}` : '';

        // Render period tabs
        await this.renderAthleteProfilePeriods();

        modal.style.display = 'block';
    }

    async renderAthleteProfilePeriods() {
        if (!this.viewingAthleteId) return;

        await this.getAllPeriods();
        const periodTabs = document.getElementById('athleteProfilePeriodTabs');
        periodTabs.innerHTML = '';

        if (this.periods.length === 0) {
            periodTabs.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No periods created yet. Create periods in the Weigh Ins tab.</p>';
            document.getElementById('athleteLiftsContainer').innerHTML = '';
            return;
        }

        // Add period tabs
        this.periods.forEach(period => {
            const periodTab = document.createElement('button');
            periodTab.className = 'btn btn-secondary period-tab';
            periodTab.style.cssText = 'padding: 8px 16px; font-size: 14px; white-space: nowrap;';
            if (this.viewingAthletePeriodId === period.id || (!this.viewingAthletePeriodId && period === this.periods[0])) {
                this.viewingAthletePeriodId = period.id;
                periodTab.classList.add('active');
                periodTab.style.background = 'var(--primary-color)';
                periodTab.style.color = 'white';
            }
            periodTab.textContent = period.name;
            periodTab.addEventListener('click', () => {
                this.viewingAthletePeriodId = period.id;
                this.renderAthleteProfilePeriods();
            });
            periodTabs.appendChild(periodTab);
        });

        // Render lifts for selected period
        this.renderAthleteLifts();
    }

    async renderAthleteLifts() {
        if (!this.viewingAthleteId || !this.viewingAthletePeriodId) return;

        const container = document.getElementById('athleteLiftsContainer');
        container.innerHTML = '';

        // Get existing lifts data for this athlete and period
        const existingLifts = await this.getAthleteLifts(this.viewingAthleteId, this.viewingAthletePeriodId);

        // Create physical attributes row (Weight and Height) - separate row
        const physicalRow = document.createElement('div');
        physicalRow.className = 'physical-attributes-row';
        
        this.physicalAttributes.forEach(attr => {
            const attrDiv = document.createElement('div');
            attrDiv.className = 'physical-attribute-box';
            
            const value = existingLifts && existingLifts[attr.id] ? existingLifts[attr.id] : '';
            
            attrDiv.innerHTML = `
                <label for="lift_${attr.id}">
                    <span>${attr.name}</span>
                    <span>${attr.unit}</span>
                </label>
                <input 
                    type="number" 
                    id="lift_${attr.id}" 
                    placeholder="0" 
                    value="${value}"
                    step="${attr.isWeight ? '1' : '0.01'}"
                    min="0"
                    class="physical-attr-input"
                >
            `;
            
            physicalRow.appendChild(attrDiv);
        });
        
        // Add listener to weight input to recalculate all ratios
        setTimeout(() => {
            const weightInput = document.getElementById('lift_weight');
            if (weightInput) {
                weightInput.addEventListener('input', () => {
                    // Trigger recalculation for all weight lifts
                    const weightLiftIds = ['bench', 'dead', 'squat', 'clean', 'incline'];
                    weightLiftIds.forEach(liftId => {
                        const liftInput = document.getElementById(`lift_${liftId}`);
                        if (liftInput) {
                            liftInput.dispatchEvent(new Event('input'));
                        }
                    });
                    // Update lift rating
                    this.updateLiftRating();
                });
            }
        }, 150);
        
        container.appendChild(physicalRow);

        // Create Lift Rating section (at the top, above weight lifts)
        const liftRatingSection = document.createElement('div');
        liftRatingSection.id = 'liftRatingSection';
        liftRatingSection.className = 'lift-rating-section';
        liftRatingSection.style.cssText = 'margin-top: 0; margin-bottom: 15px; padding: 20px; background: rgba(102, 126, 234, 0.1); border-radius: 12px; text-align: center;';
        liftRatingSection.innerHTML = `
            <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px; font-weight: 600;">LIFT RATING</div>
            <div id="liftRatingValue" style="font-size: 32px; font-weight: 700; color: var(--primary-color); font-family: 'Arial Black', 'Helvetica Neue', Arial, sans-serif;">--</div>
        `;
        container.appendChild(liftRatingSection);

        // Create lifts container for the 3-column grid
        const liftsGrid = document.createElement('div');
        liftsGrid.className = 'lifts-grid-container';

        // Separate lifts into categories
        const weightLifts = this.lifts.filter(l => ['bench', 'dead', 'squat', 'clean', 'incline'].includes(l.id));
        const runLifts = this.lifts.filter(l => ['forty', 'agility'].includes(l.id));
        const vertLift = this.lifts.find(l => l.id === 'vert');

        // Create input for weight lifts first
        weightLifts.forEach(lift => {
            const liftDiv = document.createElement('div');
            liftDiv.className = 'lift-input-box';
            
            const value = existingLifts && existingLifts[lift.id] ? existingLifts[lift.id] : '';
            const isWeightLift = ['bench', 'dead', 'squat', 'clean', 'incline'].includes(lift.id);
            
            // Calculate ratio if weight exists and this is a weight lift
            let ratioDisplay = '';
            if (isWeightLift && existingLifts && existingLifts.weight && existingLifts.weight > 0 && value) {
                const ratio = (parseFloat(value) / parseFloat(existingLifts.weight)).toFixed(2);
                ratioDisplay = `<div class="lift-ratio">${ratio}x</div>`;
            }
            
            liftDiv.innerHTML = `
                <label for="lift_${lift.id}">
                    <span>${lift.name}</span>
                    ${!isWeightLift ? `<span>${lift.unit}</span>` : ''}
                </label>
                <div class="lift-input-wrapper">
                    <div style="position: relative; display: inline-block;">
                        <input 
                            type="number" 
                            id="lift_${lift.id}" 
                            placeholder="0" 
                            value="${value}"
                            step="${lift.isWeight ? '1' : '0.01'}"
                            min="0"
                            class="${isWeightLift ? 'lift-with-unit' : ''}"
                        >
                        ${isWeightLift ? '<span class="input-unit">lbs</span>' : ''}
                    </div>
                    ${ratioDisplay}
                </div>
            `;
            
            // Add event listener for real-time calculation
            if (isWeightLift) {
                setTimeout(() => {
                    const input = document.getElementById(`lift_${lift.id}`);
                    const weightInput = document.getElementById('lift_weight');
                    if (input && weightInput) {
                        const updateRatio = () => {
                            const liftValue = parseFloat(input.value) || 0;
                            const weightValue = parseFloat(weightInput.value) || 0;
                            const wrapper = liftDiv.querySelector('.lift-input-wrapper');
                            let ratioDiv = wrapper.querySelector('.lift-ratio');
                            
                            if (liftValue > 0 && weightValue > 0) {
                                const ratio = (liftValue / weightValue).toFixed(2);
                                if (ratioDiv) {
                                    ratioDiv.textContent = `${ratio}x`;
                                    ratioDiv.style.display = 'block';
                                } else {
                                    ratioDiv = document.createElement('div');
                                    ratioDiv.className = 'lift-ratio';
                                    ratioDiv.textContent = `${ratio}x`;
                                    wrapper.appendChild(ratioDiv);
                                }
                            } else if (ratioDiv) {
                                ratioDiv.style.display = 'none';
                            }
                        };
                        
                        input.addEventListener('input', () => {
                            updateRatio();
                            this.updateLiftRating();
                        });
                        weightInput.addEventListener('input', () => {
                            updateRatio();
                            this.updateLiftRating();
                        });
                        updateRatio(); // Initial calculation
                    }
                }, 100);
            }
            
            liftsGrid.appendChild(liftDiv);
        });
        
        container.appendChild(liftsGrid);

        // Create a row for Forty and Agility (using 3-column grid, each taking 1 column)
        const runsRow = document.createElement('div');
        runsRow.className = 'lifts-grid-container';
        runsRow.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 15px;';

        runLifts.forEach(lift => {
            const liftDiv = document.createElement('div');
            liftDiv.className = 'lift-input-box';
            
            const value = existingLifts && existingLifts[lift.id] ? existingLifts[lift.id] : '';
            
            liftDiv.innerHTML = `
                <label for="lift_${lift.id}">
                    <span>${lift.name}</span>
                    <span>${lift.unit}</span>
                </label>
                <div class="lift-input-wrapper">
                    <div style="position: relative; display: inline-block;">
                        <input 
                            type="number" 
                            id="lift_${lift.id}" 
                            placeholder="0" 
                            value="${value}"
                            step="0.01"
                            min="0"
                        >
                    </div>
                </div>
            `;
            
            runsRow.appendChild(liftDiv);
        });
        // Add empty div to fill the third column
        const emptyDiv1 = document.createElement('div');
        runsRow.appendChild(emptyDiv1);

        // Create a separate row for Vert (using 3-column grid, Vert takes 1 column)
        const vertRow = document.createElement('div');
        vertRow.className = 'lifts-grid-container';
        vertRow.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 15px;';

        if (vertLift) {
            const liftDiv = document.createElement('div');
            liftDiv.className = 'lift-input-box';
            
            const value = existingLifts && existingLifts[vertLift.id] ? existingLifts[vertLift.id] : '';
            
            liftDiv.innerHTML = `
                <label for="lift_${vertLift.id}">
                    <span>${vertLift.name}</span>
                    <span>${vertLift.unit}</span>
                </label>
                <div class="lift-input-wrapper">
                    <div style="position: relative; display: inline-block;">
                        <input 
                            type="number" 
                            id="lift_${vertLift.id}" 
                            placeholder="0" 
                            value="${value}"
                            step="0.01"
                            min="0"
                        >
                    </div>
                </div>
            `;
            
            vertRow.appendChild(liftDiv);
        }
        // Add empty divs to fill the remaining columns
        const emptyDiv2 = document.createElement('div');
        const emptyDiv3 = document.createElement('div');
        vertRow.appendChild(emptyDiv2);
        vertRow.appendChild(emptyDiv3);
        
        container.appendChild(runsRow);
        container.appendChild(vertRow);
        
        // Calculate and display initial lift rating
        setTimeout(() => {
            this.updateLiftRating();
        }, 200);
    }

    updateLiftRating() {
        const weightLiftIds = ['bench', 'dead', 'squat', 'clean', 'incline'];
        const weightInput = document.getElementById('lift_weight');
        const ratingValue = document.getElementById('liftRatingValue');
        
        if (!weightInput || !ratingValue) return;
        
        const weightValue = parseFloat(weightInput.value) || 0;
        
        if (weightValue <= 0) {
            ratingValue.textContent = '--';
            return;
        }
        
        const ratios = [];
        weightLiftIds.forEach(liftId => {
            const liftInput = document.getElementById(`lift_${liftId}`);
            if (liftInput) {
                const liftValue = parseFloat(liftInput.value) || 0;
                if (liftValue > 0) {
                    const ratio = parseFloat(liftValue) / weightValue;
                    ratios.push(ratio);
                }
            }
        });
        
        if (ratios.length > 0) {
            const average = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
            ratingValue.textContent = average.toFixed(2) + 'x';
        } else {
            ratingValue.textContent = '--';
        }
    }

    async saveAthleteLiftsData() {
        if (!this.viewingAthleteId || !this.viewingAthletePeriodId) {
            alert('Error: No athlete or period selected');
            return;
        }

        const liftsData = {};
        
        // Save physical attributes
        this.physicalAttributes.forEach(attr => {
            const input = document.getElementById(`lift_${attr.id}`);
            const value = input.value.trim();
            if (value) {
                liftsData[attr.id] = attr.isWeight ? parseFloat(value) : parseFloat(value);
            }
        });
        
        // Save lifts
        this.lifts.forEach(lift => {
            const input = document.getElementById(`lift_${lift.id}`);
            const value = input.value.trim();
            if (value) {
                liftsData[lift.id] = lift.isWeight ? parseFloat(value) : parseFloat(value);
            }
        });

        // Check if record already exists
        const existing = await this.getAthleteLifts(this.viewingAthleteId, this.viewingAthletePeriodId);
        const athleteLifts = {
            athleteId: this.viewingAthleteId,
            periodId: this.viewingAthletePeriodId,
            ...liftsData
        };

        if (existing) {
            athleteLifts.id = existing.id;
        }

        try {
            await this.saveAthleteLifts(athleteLifts);
            alert('Lifts & Runs saved successfully!');
        } catch (error) {
            console.error('Error saving lifts:', error);
            alert('Error saving lifts & runs');
        }
    }

    openAthleteModal(athleteId = null) {
        this.editingAthleteId = athleteId;
        const modal = document.getElementById('athleteModal');
        const form = document.getElementById('athleteForm');
        const title = document.getElementById('athleteModalTitle');
        const deleteBtn = document.getElementById('deleteAthleteBtn');

        if (athleteId) {
            const athlete = this.athletes.find(a => a.id === athleteId);
            if (athlete) {
                title.textContent = 'Edit Athlete';
                document.getElementById('athleteNameInput').value = athlete.name || '';
                document.getElementById('athleteClassOfInput').value = athlete.classOf || '';
                document.getElementById('athleteGenderInput').value = athlete.gender || '';
                deleteBtn.style.display = 'block';
            }
        } else {
            title.textContent = 'Add Athlete';
            form.reset();
            document.getElementById('athleteClassOfInput').value = '';
            document.getElementById('athleteGenderInput').value = this.currentGender; // Pre-select current gender view
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'block';
    }

    async saveAthlete() {
        const name = document.getElementById('athleteNameInput').value.trim();
        if (!name) {
            alert('Please enter athlete name');
            return;
        }

        const gender = document.getElementById('athleteGenderInput').value;
        if (!gender) {
            alert('Please select gender');
            return;
        }

        const athlete = {
            name: name,
            classOf: document.getElementById('athleteClassOfInput').value || null,
            gender: gender
        };

        try {
            if (this.editingAthleteId) {
                athlete.id = this.editingAthleteId;
                await this.updateAthlete(athlete);
            } else {
                await this.addAthlete(athlete);
            }

            document.getElementById('athleteModal').style.display = 'none';
            // Switch to the gender view of the saved athlete
            if (athlete.gender !== this.currentGender) {
                this.currentGender = athlete.gender;
                this.updateGenderToggleButton();
            }
            // Update class filter dropdown to reflect new/updated athlete
            this.updateClassFilter();
            this.renderAthletes();
            this.updateAthleteSelects();
            // Refresh profile if it's open
            if (this.viewingAthleteId === athlete.id) {
                this.openAthleteProfile(athlete.id);
            }
            // Refresh weigh-ins if on that tab
            if (this.currentPeriodId) {
                this.renderWeighIns();
            }
        } catch (error) {
            console.error('Error saving athlete:', error);
            alert('Error saving athlete');
        }
    }

    async deleteAthleteHandler(athleteId) {
        const athlete = this.athletes.find(a => a.id === athleteId);
        if (!athlete) return;

        const confirmDelete = confirm(`Are you sure you want to delete "${athlete.name}"? This will also delete all weigh-ins and data for this athlete.`);
        if (!confirmDelete) return;

        try {
            await this.deleteAthlete(athleteId);
            
            // Close modal
            document.getElementById('athleteModal').style.display = 'none';
            
            // Close profile modal if it's open for this athlete
            if (this.viewingAthleteId === athleteId) {
                document.getElementById('athleteProfileModal').style.display = 'none';
                this.viewingAthleteId = null;
            }
            
            // Update class filter dropdown (in case class becomes empty)
            await this.updateClassFilter();
            
            // Refresh UI
            this.renderAthletes();
            this.updateAthleteSelects();
            
            // Refresh weigh-ins if on that tab
            if (this.currentPeriodId) {
                this.renderWeighIns();
            }
        } catch (error) {
            console.error('Error deleting athlete:', error);
            alert('Error deleting athlete: ' + error.message);
        }
    }

    openWeighInModal(weighInId = null) {
        if (!this.currentPeriodId) {
            alert('Please select a period first');
            return;
        }

        // Update athlete select dropdown
        this.updateWeighInAthleteSelect();

        this.editingWeighInId = weighInId;
        const modal = document.getElementById('weighInModal');
        const form = document.getElementById('weighInForm');
        const title = document.getElementById('weighInModalTitle');
        const exercisesContainer = document.getElementById('exercisesContainer');

        // Set default date to today
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('weighInDateInput').value = today;

        if (weighInId) {
            const weighIn = this.weighIns.find(w => w.id === weighInId);
            if (weighIn) {
                title.textContent = 'Edit Weigh In';
                document.getElementById('weighInAthleteSelect').value = weighIn.athleteId || '';
                document.getElementById('weighInDateInput').value = weighIn.date;
                document.getElementById('weighInNotesInput').value = weighIn.notes || '';
                
                exercisesContainer.innerHTML = '';
                weighIn.exercises.forEach(exercise => {
                    this.addExerciseInput(exercise);
                });
            }
        } else {
            title.textContent = 'Add Weigh In';
            form.reset();
            document.getElementById('weighInDateInput').value = today;
            document.getElementById('weighInAthleteSelect').value = '';
            exercisesContainer.innerHTML = '';
            this.addExerciseInput();
        }

        modal.style.display = 'block';
    }

    updateWeighInAthleteSelect() {
        const select = document.getElementById('weighInAthleteSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- Select Athlete --</option>';
        // Filter athletes by current gender
        const genderFilteredAthletes = this.athletes.filter(a => a.gender === this.currentGender);
        genderFilteredAthletes.forEach(athlete => {
            const option = document.createElement('option');
            option.value = athlete.id;
            option.textContent = athlete.name;
            select.appendChild(option);
        });
    }

    addExerciseInput(exercise = null) {
        const exercisesContainer = document.getElementById('exercisesContainer');
        const exerciseDiv = document.createElement('div');
        exerciseDiv.className = 'exercise-input';
        
        const exerciseId = exercise ? exercise.id : this.generateId();
        const exerciseName = exercise ? exercise.name : '';
        
        exerciseDiv.innerHTML = `
            <div class="exercise-input-header">
                <input type="text" class="form-control exercise-input-name" placeholder="Exercise name" value="${exerciseName}" required>
                <button type="button" class="remove-exercise-btn" onclick="app.removeExerciseInput(this)">Remove</button>
            </div>
            <div class="sets-container" data-exercise-id="${exerciseId}">
                ${exercise ? exercise.sets.map((set, idx) => this.createSetInput(exerciseId, idx, set)).join('') : this.createSetInput(exerciseId, 0)}
            </div>
            <button type="button" class="add-set-btn" onclick="app.addSet(this)">➕ Add Set</button>
        `;
        
        exercisesContainer.appendChild(exerciseDiv);
    }

    createSetInput(exerciseId, setIndex, set = null) {
        const reps = set ? set.reps : '';
        const weight = set ? set.weight : '';
        return `
            <div class="set-input">
                <span class="set-number">${setIndex + 1}</span>
                <input type="number" class="form-control" placeholder="Reps" min="1" value="${reps}" required>
                <input type="number" class="form-control" placeholder="Weight (lbs)" min="0" step="0.5" value="${weight}" required>
                ${setIndex > 0 ? '<button type="button" class="remove-set-btn" onclick="app.removeSet(this)">Remove</button>' : ''}
            </div>
        `;
    }

    addSet(btn) {
        const setsContainer = btn.previousElementSibling;
        const exerciseId = setsContainer.getAttribute('data-exercise-id');
        const setIndex = setsContainer.children.length;
        const setDiv = document.createElement('div');
        setDiv.className = 'set-input';
        setDiv.innerHTML = this.createSetInput(exerciseId, setIndex).replace('</div>', '<button type="button" class="remove-set-btn" onclick="app.removeSet(this)">Remove</button></div>');
        setsContainer.appendChild(setDiv);
    }

    removeSet(btn) {
        btn.closest('.set-input').remove();
        // Renumber sets
        const setsContainer = btn.closest('.sets-container');
        setsContainer.querySelectorAll('.set-input').forEach((setInput, index) => {
            setInput.querySelector('.set-number').textContent = index + 1;
        });
    }

    removeExerciseInput(btn) {
        btn.closest('.exercise-input').remove();
    }

    async saveWeighIn() {
        const athleteId = document.getElementById('weighInAthleteSelect').value;
        if (!athleteId) {
            alert('Please select an athlete');
            return;
        }

        const date = document.getElementById('weighInDateInput').value;
        if (!date) {
            alert('Please select a date');
            return;
        }

        const exercisesContainer = document.getElementById('exercisesContainer');
        const exercises = [];

        exercisesContainer.querySelectorAll('.exercise-input').forEach(exerciseDiv => {
            const exerciseName = exerciseDiv.querySelector('.exercise-input-name').value.trim();
            if (!exerciseName) return;

            const sets = [];
            exerciseDiv.querySelectorAll('.set-input').forEach(setInput => {
                const reps = parseInt(setInput.querySelectorAll('input')[0].value);
                const weight = parseFloat(setInput.querySelectorAll('input')[1].value);
                
                if (reps && weight) {
                    sets.push({ reps, weight });
                }
            });

            if (sets.length > 0) {
                exercises.push({
                    id: exerciseDiv.querySelector('.sets-container').getAttribute('data-exercise-id'),
                    name: exerciseName,
                    sets: sets
                });
            }
        });

        if (exercises.length === 0) {
            alert('Please add at least one exercise with sets');
            return;
        }

        const weighIn = {
            athleteId: athleteId,
            periodId: this.currentPeriodId,
            date: date,
            exercises: exercises,
            notes: document.getElementById('weighInNotesInput').value.trim() || null
        };

        try {
            if (this.editingWeighInId) {
                weighIn.id = this.editingWeighInId;
                await this.updateWeighIn(weighIn);
            } else {
                await this.addWeighIn(weighIn);
            }

            document.getElementById('weighInModal').style.display = 'none';
            this.renderWeighIns();
            if (document.getElementById('progressTab').classList.contains('active')) {
                const athleteId = document.getElementById('progressAthleteSelect').value;
                if (athleteId) {
                    this.renderProgress(athleteId);
                }
            }
        } catch (error) {
            console.error('Error saving weigh in:', error);
            alert('Error saving weigh in');
        }
    }

    async deleteWeighInHandler(weighInId) {
        if (confirm('Are you sure you want to delete this weigh in?')) {
            try {
                await this.deleteWeighIn(weighInId);
                this.renderWeighIns();
                if (document.getElementById('progressTab').classList.contains('active')) {
                    const athleteId = document.getElementById('progressAthleteSelect').value;
                    if (athleteId) {
                        this.renderProgress(athleteId);
                    }
                }
            } catch (error) {
                console.error('Error deleting weigh in:', error);
                alert('Error deleting weigh in');
            }
        }
    }

    openPeriodModal(periodId = null) {
        const modal = document.getElementById('periodModal');
        const form = document.getElementById('periodForm');
        const title = document.getElementById('periodModalTitle');

        if (periodId) {
            const period = this.periods.find(p => p.id === periodId);
            if (period) {
                title.textContent = 'Edit Period';
                document.getElementById('periodNameInput').value = period.name || '';
            }
        } else {
            title.textContent = 'Add Period';
            form.reset();
        }

        modal.style.display = 'block';
    }

    async savePeriod() {
        const name = document.getElementById('periodNameInput').value.trim();
        if (!name) {
            alert('Please enter period name');
            return;
        }

        const period = {
            name: name,
            gender: this.currentGender // Associate period with current gender
        };

        try {
            await this.addPeriod(period);
            this.currentPeriodId = period.id;
            document.getElementById('periodModal').style.display = 'none';
            this.renderPeriods();
            this.renderWeighIns();
        } catch (error) {
            console.error('Error saving period:', error);
            alert('Error saving period');
        }
    }

    async deletePeriodHandler(periodId) {
        try {
            await this.deletePeriod(periodId);
            
            // Clear current period if it was deleted
            if (this.currentPeriodId === periodId) {
                this.currentPeriodId = null;
            }
            
            // Re-render periods and weigh-ins
            await this.renderPeriods();
            await this.renderWeighIns();
            
            // Also refresh athlete profile periods if modal is open
            if (this.viewingAthleteId) {
                await this.renderAthleteProfilePeriods();
            }
        } catch (error) {
            console.error('Error deleting period:', error);
            alert('Error deleting period: ' + error.message);
        }
    }
}

// Initialize app
let app;
window.addEventListener('DOMContentLoaded', () => {
    app = new BulldogBuilder();
});

