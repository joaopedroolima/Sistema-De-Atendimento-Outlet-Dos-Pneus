const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const admin = require('firebase-admin'); // PASSO 25: Importa o Firebase Admin
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors()); // Permite requisições de outras origens (nosso PWA)
app.use(bodyParser.json());

// =========================================================================
// PASSO 25: CONFIGURAÇÃO DO FIREBASE ADMIN
// =========================================================================
const serviceAccount = require('./serviceAccountKey.json'); // Carrega a chave que você baixou

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});

const db = admin.firestore();
console.log('✅ Conectado ao Firebase com sucesso!');

// --- Constantes do seu projeto ---
const APP_ID = 'local-autocenter-app';
const ALIGNMENT_COLLECTION_PATH = `artifacts/${APP_ID}/public/data/alignmentQueue`;
const STATUS_WAITING = 'Aguardando';

let isFirstRun = true; // Variável para evitar notificação na inicialização do servidor

// =========================================================================
// PASSO 9: GERAÇÃO DAS CHAVES VAPID (Voluntary Application Server Identification)
// =========================================================================
// ATENÇÃO: Substitua estas chaves pelas que você vai gerar no próximo passo.
const vapidKeys = {
    publicKey: 'BK6QJSF0wZwzNPkTDQLWENm-9HsYynNimRnye3F4RtSnxGWPjhxP8o9OZSpXKKzSQWvyt8GSz13HzKq7u4OV-KI',
    privateKey: 'q2mOnpLoKfFxfCl7pbpGMcKxOztws5_CoqS_vSUiSZo'
};

// ADICIONE ISTO:
console.log("========================================");
console.log("CHAVE PÚBLICA ATIVA NO BACKEND:");
console.log(vapidKeys.publicKey);
console.log("========================================");

// Configura o web-push com as chaves VAPID. O 'mailto' é um contato de emergência.
webpush.setVapidDetails(
    'mailto:seu-email@exemplo.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

console.log("Chaves VAPID configuradas (placeholders).");

// =========================================================================
// PASSO 10: ARMAZENAMENTO DAS SUBSCRIPTIONS
// =========================================================================
// Para este exemplo, vamos salvar as subscriptions em memória.
// Em um projeto real, você deve salvar isso em um banco de dados (Firestore, SQL, etc).
let subscriptions = [];

/**
 * Endpoint para o cliente (PWA) enviar sua subscription para o servidor.
 */
app.post('/save-subscription', (req, res) => {
    const subscription = req.body;
    
    // Verifica se já existe uma subscription com o mesmo endpoint
    const exist = subscriptions.find(sub => sub.endpoint === subscription.endpoint);

    if (!exist) {
        subscriptions.push(subscription);
        console.log('✅ Nova subscription salva:', subscription.endpoint.slice(0, 20) + '...');
    } else {
        console.log('🔄 Subscription já existente. Atualizando/Ignorando duplicata.');
        // Opcional: Aqui você poderia atualizar os dados se necessário
    }

    console.log(`Total de inscritos ativos: ${subscriptions.length}`);
    res.status(201).json({ message: 'Subscription processada com sucesso.' });
});

// =========================================================================
// PASSO 11: ENDPOINT PARA ENVIAR NOTIFICAÇÕES
// =========================================================================
/**
 * Endpoint para disparar o envio de uma notificação para todos os inscritos.
 */
// =========================================================================
// PASSO 11: ENDPOINT PARA ENVIAR NOTIFICAÇÕES (COM LIMPEZA AUTOMÁTICA)
// =========================================================================
app.post('/send-notification', (req, res) => {
    const notificationPayload = {
        notification: {
            title: req.body.title || 'Nova Notificação!',
            body: req.body.body || 'Você tem uma nova mensagem.',
            icon: 'icons/icon-192x192.png',
            data: {
                url: req.body.url || '/'
            }
        }
    };

    console.log(`Enviando notificação para ${subscriptions.length} inscritos...`);

    // Cria uma lista de promessas de envio
    const promises = subscriptions.map(sub => {
        return webpush.sendNotification(sub, JSON.stringify(notificationPayload))
            .then(() => ({ success: true })) // Sucesso
            .catch(err => {
                // Se o erro for 410 (Gone) ou 404 (Not Found), a inscrição morreu
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`🧹 Removendo inscrição inativa: ${sub.endpoint}`);
                    return { success: false, deleteEndpoint: sub.endpoint };
                }
                // Outros erros (ex: rede), apenas loga mas não deleta
                console.error("Erro de envio:", err.statusCode);
                return { success: false };
            });
    });

    // Executa tudo e depois limpa a lista
    Promise.all(promises)
        .then(results => {
            // Filtra o array original removendo os que foram marcados para deletar
            const deletedEndpoints = results
                .filter(r => r.deleteEndpoint)
                .map(r => r.deleteEndpoint);

            if (deletedEndpoints.length > 0) {
                subscriptions = subscriptions.filter(sub => !deletedEndpoints.includes(sub.endpoint));
                console.log(`Total de ${deletedEndpoints.length} inscrições fantasmas removidas.`);
                console.log(`Restam ${subscriptions.length} inscritos ativos.`);
            }

            res.status(200).json({ message: 'Processo de envio concluído.' });
        })
        .catch(err => {
            console.error("Erro geral no envio:", err);
            res.sendStatus(500);
        });
});

// =========================================================================
// PASSO 25: LÓGICA DE NEGÓCIO PARA DISPARAR NOTIFICAÇÕES
// =========================================================================

/**
 * Função que envia a notificação para todos os inscritos.
 * @param {object} carData - Dados do carro que entrou na fila.
 */
function sendAlignmentNotification(carData) {
    const notificationPayload = {
        notification: {
            title: 'Novo Carro na Fila!',
            body: `O carro ${carData.carModel} (Placa: ${carData.licensePlate}) está aguardando alinhamento.`,
            icon: 'icons/icon-192x192.png',
            data: { url: '/' } // URL para abrir ao clicar na notificação
        }
    };

    console.log(`📢 Disparando notificação para ${subscriptions.length} inscritos...`);

    const promises = subscriptions.map(sub => 
        webpush.sendNotification(sub, JSON.stringify(notificationPayload))
            .catch(err => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`🧹 Removendo inscrição inativa: ${sub.endpoint}`);
                    subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
                }
            })
    );

    Promise.all(promises).then(() => console.log('🚀 Processo de envio de notificações concluído.'));
}

// Ouve por alterações na coleção da fila de alinhamento
db.collection(ALIGNMENT_COLLECTION_PATH).onSnapshot(snapshot => {
    // Evita disparar notificações para todos os carros existentes quando o servidor liga
    if (isFirstRun) {
        isFirstRun = false;
        return;
    }

    snapshot.docChanges().forEach(change => {
        const carData = change.doc.data();

        // Se um novo carro foi ADICIONADO e já está aguardando
        if (change.type === 'added' && carData.status === STATUS_WAITING) {
            console.log('🚗 Novo carro ADICIONADO à fila de alinhamento!');
            sendAlignmentNotification(carData);
        }

        // CORREÇÃO: Se um carro existente foi MODIFICADO e seu novo status é 'Aguardando'
        // Isso captura carros vindos de outras interfaces (ex: Gerente)
        if (change.type === 'modified' && carData.status === STATUS_WAITING) {
            // Aqui, idealmente, verificaríamos se o status anterior NÃO era 'Aguardando' para evitar re-notificações.
            // Mas para garantir a notificação de todas as fontes, esta abordagem é mais segura.
            console.log('🚗 Carro existente teve seu status ALTERADO para aguardar alinhamento!');
            sendAlignmentNotification(change.doc.data());
        }
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor de Push rodando na porta ${PORT}`);
});