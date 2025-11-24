/**
 * BACKEND UNIFICADO (ALINHADORES + MECÂNICOS)
 * Arquivo: functions/index.js
 */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

setGlobalOptions({ region: "us-central1" });

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// --- Configurações ---
const ALIGNMENT_COLLECTION = "artifacts/local-autocenter-app/public/data/alignmentQueue";
const SERVICE_COLLECTION = "artifacts/local-autocenter-app/public/data/serviceJobs";
const TOKENS_COLLECTION = "device_tokens";

/**
 * FUNÇÃO 1: Notifica ALINHADORES (Broadcast por Cargo)
 */
exports.notifyAligners = onDocumentWritten(`${ALIGNMENT_COLLECTION}/{docId}`, async (event) => {
    if (!event.data) return;

    const after = event.data.after.data();
    const before = event.data.before.data();

    // Se foi excluído, ignora
    if (!after) return;

    const STATUS_TRIGGER = "Aguardando";
    const isNewJob = !before && after.status === STATUS_TRIGGER;
    const statusChanged = before && before.status !== STATUS_TRIGGER && after.status === STATUS_TRIGGER;

    if (!isNewJob && !statusChanged) return;

    console.log(`🔔 [Alinhador] Novo carro: ${after.licensePlate}`);

    // Busca tokens de quem é 'aligner' ou 'manager'
    const tokensSnapshot = await db.collection(TOKENS_COLLECTION)
        .where('role', 'in', ['aligner', 'manager'])
        .get();

    if (tokensSnapshot.empty) return;

    const tokens = tokensSnapshot.docs.map(doc => doc.id);

    const message = {
        tokens: tokens,
        notification: {
            title: "Nova Fila de Alinhamento",
            body: `${after.carModel} (${after.licensePlate}) chegou.`
        },
        webpush: { notification: { icon: "icons/icon-192x192.png" }, fcmOptions: { link: "/" } }
    };

    await sendNotifications(message, tokens);
});

/**
 * FUNÇÃO 2: Notifica MECÂNICOS (Direcionado por Nome)
 */
exports.notifyMechanics = onDocumentWritten(`${SERVICE_COLLECTION}/{docId}`, async (event) => {
    if (!event.data) return;

    const after = event.data.after.data();
    const before = event.data.before.data();

    // Se foi excluído, ignora
    if (!after) return;

    const mechanicName = after.assignedMechanic;
    const status = after.status;

    // Só notifica se estiver Pendente e tiver um mecânico atribuído
    if (status !== 'Pendente' || !mechanicName) return;

    // Gatilho: Foi criado agora OU o mecânico mudou
    const isNewAssignment = !before && mechanicName;
    const mechanicChanged = before && before.assignedMechanic !== mechanicName;

    if (!isNewAssignment && !mechanicChanged) return;

    console.log(`🔧 [Mecânico] Serviço atribuído para: ${mechanicName}`);

    // Busca token APENAS deste mecânico específico
    const tokensSnapshot = await db.collection(TOKENS_COLLECTION)
        .where('username', '==', mechanicName)
        .where('role', '==', 'mecanico')
        .get();

    if (tokensSnapshot.empty) {
        console.log(`🚫 Token não encontrado para o mecânico: ${mechanicName}`);
        return;
    }

    const tokens = tokensSnapshot.docs.map(doc => doc.id);

    const message = {
        tokens: tokens,
        notification: {
            title: "Novo Serviço Atribuído!",
            body: `Veículo: ${after.carModel} (${after.licensePlate})\nServiço: ${after.serviceDescription || 'Ver detalhes'}`
        },
        webpush: { notification: { icon: "icons/icon01.png" }, fcmOptions: { link: "/" } }
    };

    await sendNotifications(message, tokens);
});

/**
 * Função Auxiliar de Envio
 */
async function sendNotifications(message, tokens) {
    const response = await messaging.sendEachForMulticast(message);
    if (response.failureCount > 0) {
        const tokensToRemove = [];
        response.responses.forEach((resp, index) => {
            if (!resp.success) {
                const error = resp.error;
                if (error && (error.code === 'messaging/invalid-registration-token' || 
                              error.code === 'messaging/registration-token-not-registered')) {
                    tokensToRemove.push(db.collection(TOKENS_COLLECTION).doc(tokens[index]).delete());
                }
            }
        });
        await Promise.all(tokensToRemove);
    }
    console.log(`✅ Enviado: ${response.successCount} sucessos.`);
}