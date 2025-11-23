const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors()); // Permite requisições de outras origens (nosso PWA)
app.use(bodyParser.json());

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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor de Push rodando na porta ${PORT}`);
});