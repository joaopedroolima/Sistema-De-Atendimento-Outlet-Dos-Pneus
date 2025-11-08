
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
    finalizedToday: {
        services: [],
        alignments: []
    }, // Cache para serviços finalizados hoje
    users: [],
    jobIdCounter: 100,
    aliIdCounter: 200,
    MECHANICS: [], // A lista de mecânicos será populada dinamicamente
    TIRE_SHOP_MECHANIC: 'Borracheiro',
    // Firestore path constants will be filled in firebaseConfig and used as needed
};
