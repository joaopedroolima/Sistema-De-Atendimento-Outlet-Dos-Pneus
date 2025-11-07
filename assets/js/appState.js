
export const state = {
    db: null,
    auth: null,
    analytics: null,
    userId: 'loading',
    isAuthReady: false,
    currentUserRole: null,
    isLoggedIn: false,
    serviceJobs: [],
    alignmentQueue: [],
    jobIdCounter: 100,
    aliIdCounter: 200,
    MECHANICS: ['José','Wendell'],
    TIRE_SHOP_MECHANIC: 'Borracheiro',
    // Firestore path constants will be filled in firebaseConfig and used as needed
};
