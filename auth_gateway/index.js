const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

// --- Configurações e Constantes ---
// É uma boa prática carregar configurações de variáveis de ambiente.
// Para isso, você pode usar um pacote como `dotenv`.
// Ex: `npm install dotenv` e `require('dotenv').config();`
const PORT = process.env.PORT || 3001;
const SESSION_SECRET = process.env.SESSION_SECRET || 'SEU_SEGREDO_DE_SESSAO_COMPARTILHADO';
const IS_PROD = process.env.NODE_ENV === 'production';

const PROFILES = {
    MARKETING: 'Analista de Marketing',
    SALES: 'Vendedor',
    MANAGER: 'Gerente',
};

const REDIRECT_URLS = {
    LOGIN: '/operacional_system/login.php?error=session_expired',
    OPERATIONAL_HOME: '/operacional_system/index.php',
    MARKETING_HOME: '/marketing', // Alteramos para uma rota virtual
};

const app = express();

// --- Configuração da Sessão ---
// IMPORTANTE: O 'secret' deve ser o mesmo usado no seu `operacional_system`
// para que a sessão possa ser compartilhada e lida corretamente.
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        // Em produção, o cookie deve ser seguro para ser enviado apenas via HTTPS
        secure: IS_PROD,
        // httpOnly: true é o padrão e previne acesso ao cookie via JavaScript no cliente
        httpOnly: true,
        // Define um tempo de vida para o cookie da sessão, se desejado
        // maxAge: 1000 * 60 * 60 * 24 // 24 horas
    }
}));

// --- Módulo de Log (RF007) ---
const logStream = fs.createWriteStream(path.join(__dirname, 'logs', 'marketing_access.log'), { flags: 'a' });

function writeLog(userId, profile, message) {
    const logEntry = `[${new Date().toISOString()}] UserID: ${userId || 'N/A'}, Profile: ${profile || 'N/A'}, Status: ${message}\n`;
    logStream.write(logEntry);
    console.log(logEntry.trim()); // Também exibe no console para debugging
}

// --- Middleware de Proteção para a Interface de Marketing ---
// Este middleware será usado para proteger as rotas de marketing.
function protectMarketingRoute(req, res, next) {
    const { userProfile } = req.session || {};
    const allowedProfiles = [PROFILES.MARKETING, PROFILES.SALES, PROFILES.MANAGER];

    if (userProfile && allowedProfiles.includes(userProfile)) {
        // Se o perfil é permitido, continua para servir o arquivo estático.
        return next();
    }

    // Se não tem sessão ou perfil válido, nega o acesso.
    writeLog(req.session?.userId, userProfile, 'Acesso direto negado à rota de marketing');
    res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar este recurso diretamente.</p>');
}

// --- Rota Principal do Gateway ---
app.get('/auth', (req, res) => {
    // 1. Valida se existe uma sessão ativa
    if (!req.session || !req.session.userId || !req.session.userProfile) {
        writeLog(null, null, 'Acesso negado - Sessão inválida ou expirada');
        // Redireciona de volta para a tela de login
        return res.redirect(REDIRECT_URLS.LOGIN);
    }

    const { userId, userProfile } = req.session;

    // 2. Define perfis autorizados (RF002)
    const directAccessProfiles = [PROFILES.MARKETING];
    const buttonAccessProfiles = [PROFILES.SALES, PROFILES.MANAGER];
    const allAllowedProfiles = [...directAccessProfiles, ...buttonAccessProfiles];

    // 3. Verifica se o perfil do usuário tem permissão
    if (!allAllowedProfiles.includes(userProfile)) {
        writeLog(userId, userProfile, 'Acesso negado - Perfil não autorizado');
        return res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar este módulo.</p>');
    }

    // 4. Aplica as regras de redirecionamento (RF003, RF005)
    writeLog(userId, userProfile, 'Acesso autorizado');

    // Se for Analista de Marketing, vai direto para a interface de marketing
    if (directAccessProfiles.includes(userProfile)) {
        return res.redirect(REDIRECT_URLS.MARKETING_HOME);
    }

    // Se for Vendedor ou Gerente...
    if (buttonAccessProfiles.includes(userProfile)) {
        // Verificamos de onde o usuário veio para decidir o destino.
        const referer = req.get('Referer') || '';

        // Se veio de dentro do sistema operacional (clicou no botão), vai para o marketing.
        // A URL deve ser ajustada conforme o endereço do seu sistema.
        if (referer.includes('/operacional_system/')) {
            return res.redirect(REDIRECT_URLS.MARKETING_HOME);
        } else {
            // Se veio do login, vai para a tela principal do sistema operacional.
            return res.redirect(REDIRECT_URLS.OPERATIONAL_HOME);
        }
    }

    // Fallback de segurança
    writeLog(userId, userProfile, 'Acesso negado - Regra de perfil não encontrada');
    res.status(403).send('Acesso Negado. Contate o administrador.');
});

// --- Servir Arquivos Estáticos da Interface de Marketing (RF006, RNF002) ---
// A rota '/marketing' é protegida pelo nosso middleware.
// O express.static serve os arquivos da pasta `marketing_interface`.
// Agora, o único jeito de acessar `index.html` é passando pelo gateway.
app.use('/marketing', protectMarketingRoute, express.static(path.join(__dirname, '../marketing_interface')));

app.listen(PORT, () => {
    console.log(`Gateway de autenticação rodando na porta ${PORT}`);
});
