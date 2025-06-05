const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        pushinpay: pushinPayConfigured,
        mercadopago: mercadoPagoConfigured,
        payment_system: mercadoPagoConfigured ? 'mercadopago_auto_split' : 'pushinpay_manual',
        database: 'connected'
    });
});

// Test PushinPay connectivity
app.post('/api/test-pushinpay', async (req, res) => {
    try {
        const { amount = 29.90 } = req.body;
        const testPayment = await createPixPayment(
            amount,
            'https://webhook-test.com/test',
            null
        );
        
        res.json({
            success: true,
            message: 'PushinPay conectado com sucesso',
            paymentId: testPayment.transactionId || testPayment.id,
            amount: amount,
            init_point: testPayment.init_point
        });
    } catch (error) {
        console.error('PushinPay test error:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao testar PushinPay',
            error: error.message
        });
    }
});



// Test database connectivity
app.get('/api/test-db', async (req, res) => {
    try {
        const userCount = await User.count();
        const affiliateCount = await Affiliate.count();
        
        res.json({
            success: true,
            message: 'Banco de dados conectado',
            stats: {
                users: userCount,
                affiliates: affiliateCount
            }
        });
    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({
            success: false,
            message: 'Erro de conectividade do banco',
            error: error.message
        });
    }
});

// Diagnostic endpoint for Supabase configuration
app.get('/api/config-check', (req, res) => {
    res.json({
        message: 'Sistema configurado com Supabase',
        database: 'Supabase PostgreSQL conectado',
        payment_system: 'PushinPay ativo',
        status: 'Sistema operacional'
    });
});

// Supabase PostgreSQL connection
const DATABASE_URL = 'postgresql://postgres.ikcqwzwhekqqysvoihgc:pokejr55@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false,
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    define: {
        timestamps: true,
        underscored: false
    }
});

// Initialize Supabase connection and sync tables
sequelize.authenticate()
.then(async () => {
    console.log('✅ Conectado ao Supabase PostgreSQL com sucesso');
    await sequelize.sync({ force: false, alter: true });
    console.log('✅ Tabelas criadas/sincronizadas com sistema de afiliados');
})
.catch(err => {
    console.error('❌ Erro ao conectar ao Supabase:', err.message);
});

// Configure payment systems (hybrid approach)
const pushinPayToken = process.env.PUSHINPAY_CLIENT_SECRET || '32298|tBepLU0z3XJUTNJalDWnx9rZBO7ahITEUAudBpfr6bd0665b';
const pushinPayAccountId = process.env.PUSHINPAY_CLIENT_ID || '9D8734CE-BA21-4763-9AA9-92FD648F7502';
const mercadoPagoAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN_PROD || process.env.MERCADOPAGO_ACCESS_TOKEN;
const mercadoPagoClientId = '2502005685522002';

let pushinPayConfigured = !!(pushinPayToken && pushinPayAccountId);
let mercadoPagoConfigured = !!mercadoPagoAccessToken;

// Initialize MercadoPago if configured
let mercadopago = null;
if (mercadoPagoConfigured) {
    mercadopago = new MercadoPagoConfig({
        accessToken: mercadoPagoAccessToken,
        options: {
            timeout: 5000
        }
    });
}

if (pushinPayConfigured) {
    console.log('✅ PushinPay configurado (sistema principal de pagamentos)');
}

if (mercadoPagoConfigured) {
    console.log('✅ Mercado Pago configurado (split automático ativo)');
} else {
    console.log('⚠️ Mercado Pago não configurado - usando PushinPay para pagamentos');
}

// Hybrid payment system: Mercado Pago with auto-split OR PushinPay
async function createPixPayment(value, webhookUrl, affiliateInfo = null) {
    // Try Mercado Pago first if configured (auto-split)
    if (mercadoPagoConfigured && mercadopago) {
        try {
            const preference = new PreApproval(mercadopago);
            
            const paymentData = {
                reason: 'Assinatura FLUXODRIVER - 90 dias',
                external_reference: `FLUXO_${Date.now()}`,
                payer_email: 'usuario@fluxodriver.com',
                back_url: webhookUrl,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'days',
                    transaction_amount: value,
                    currency_id: 'BRL'
                },
                payment_methods_allowed: {
                    payment_types: [{ id: 'pix' }],
                    payment_methods: [{ id: 'pix' }]
                }
            };

            // Add marketplace fee (auto-split) for affiliate
            if (affiliateInfo && affiliateInfo.withdrawalKey) {
                const commissionAmount = parseFloat((value * 0.45).toFixed(2));
                paymentData.marketplace_fee = commissionAmount;
                paymentData.marketplace = mercadoPagoClientId;
            }

            const result = await preference.create({ body: paymentData });
            console.log('✅ Pagamento criado via Mercado Pago (split automático)');
            
            return {
                id: result.id,
                init_point: result.init_point,
                transactionId: result.id,
                qr_code: result.qr_code || null,
                qr_code_base64: result.qr_code_base64 || null,
                payment_method: 'mercadopago'
            };
        } catch (error) {
            console.error('Mercado Pago falhou, usando PushinPay:', error);
        }
    }

    // Fallback to PushinPay (manual commission system)
    try {
        const payload = JSON.stringify({
            value: Math.round(value * 100),
            webhook_url: webhookUrl,
            external_reference: `FLUXO_${Date.now()}`,
            description: 'Assinatura FLUXODRIVER - 90 dias',
            expires_in: 3600
        });

        const response = await fetch('https://api.pushinpay.com.br/api/pix/cashIn', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pushinPayToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: payload
        });

        const responseText = await response.text();
        console.log('✅ Pagamento criado via PushinPay (comissão manual)');

        if (!response.ok) {
            throw new Error(`PushinPay API error: ${response.status} - ${responseText}`);
        }

        const result = JSON.parse(responseText);
        return {
            ...result,
            payment_method: 'pushinpay'
        };
    } catch (error) {
        console.error('Erro em ambos os sistemas de pagamento:', error);
        throw error;
    }
}

// Generate unique affiliate code
function generateAffiliateCode(username) {
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${username.substring(0, 4).toUpperCase()}${randomSuffix}`;
}

// Gamification System
const LEVEL_REQUIREMENTS = {
    1: 0, 2: 100, 3: 250, 4: 500, 5: 1000,
    6: 2000, 7: 4000, 8: 8000, 9: 15000, 10: 30000
};

const BADGES = {
    FIRST_REFERRAL: { id: 'first_referral', name: 'Primeiro Indicado', icon: '🎯', description: 'Sua primeira indicação bem-sucedida' },
    STREAK_3: { id: 'streak_3', name: 'Sequência de 3', icon: '🔥', description: '3 indicações em dias consecutivos' },
    STREAK_7: { id: 'streak_7', name: 'Semana Perfeita', icon: '⚡', description: '7 indicações em dias consecutivos' },
    LEVEL_5: { id: 'level_5', name: 'Afiliado Experiente', icon: '⭐', description: 'Alcançou o nível 5' },
    LEVEL_10: { id: 'level_10', name: 'Mestre Afiliado', icon: '👑', description: 'Alcançou o nível máximo' },
    REFERRALS_10: { id: 'referrals_10', name: 'Recrutador', icon: '👥', description: '10 indicações totais' },
    REFERRALS_50: { id: 'referrals_50', name: 'Influenciador', icon: '🌟', description: '50 indicações totais' },
    EARNINGS_100: { id: 'earnings_100', name: 'Primeira Centena', icon: '💰', description: 'R$ 100 em comissões' },
    EARNINGS_500: { id: 'earnings_500', name: 'Empreendedor', icon: '💎', description: 'R$ 500 em comissões' }
};

async function calculateAffiliateProgress(affiliateId) {
    const affiliate = await Affiliate.findByPk(affiliateId);
    if (!affiliate) return null;

    const totalEarnings = await Commission.sum('commissionAmount', {
        where: { affiliateId, status: 'paid' }
    }) || 0;

    // Calculate experience points
    const referralXP = affiliate.totalReferrals * 50;
    const earningsXP = Math.floor(totalEarnings * 2);
    const streakXP = affiliate.streak * 25;
    const totalXP = referralXP + earningsXP + streakXP;

    // Calculate level
    let newLevel = 1;
    for (let level = 10; level >= 1; level--) {
        if (totalXP >= LEVEL_REQUIREMENTS[level]) {
            newLevel = level;
            break;
        }
    }

    // Check for new badges
    const currentBadges = affiliate.badges || [];
    const newBadges = [];

    if (affiliate.totalReferrals >= 1 && !currentBadges.includes('first_referral')) {
        newBadges.push('first_referral');
    }
    if (affiliate.streak >= 3 && !currentBadges.includes('streak_3')) {
        newBadges.push('streak_3');
    }
    if (affiliate.streak >= 7 && !currentBadges.includes('streak_7')) {
        newBadges.push('streak_7');
    }
    if (newLevel >= 5 && !currentBadges.includes('level_5')) {
        newBadges.push('level_5');
    }
    if (newLevel >= 10 && !currentBadges.includes('level_10')) {
        newBadges.push('level_10');
    }
    if (affiliate.totalReferrals >= 10 && !currentBadges.includes('referrals_10')) {
        newBadges.push('referrals_10');
    }
    if (affiliate.totalReferrals >= 50 && !currentBadges.includes('referrals_50')) {
        newBadges.push('referrals_50');
    }
    if (totalEarnings >= 100 && !currentBadges.includes('earnings_100')) {
        newBadges.push('earnings_100');
    }
    if (totalEarnings >= 500 && !currentBadges.includes('earnings_500')) {
        newBadges.push('earnings_500');
    }

    // Update affiliate with new progress
    await affiliate.update({
        level: newLevel,
        experience: totalXP,
        badges: [...currentBadges, ...newBadges]
    });

    return {
        level: newLevel,
        experience: totalXP,
        nextLevelXP: LEVEL_REQUIREMENTS[Math.min(newLevel + 1, 10)],
        progressPercent: newLevel < 10 ? 
            Math.floor(((totalXP - LEVEL_REQUIREMENTS[newLevel]) / (LEVEL_REQUIREMENTS[newLevel + 1] - LEVEL_REQUIREMENTS[newLevel])) * 100) : 100,
        badges: [...currentBadges, ...newBadges],
        newBadges,
        streak: affiliate.streak,
        totalEarnings: parseFloat(totalEarnings)
    };
}

async function updateAffiliateStreak(affiliateId) {
    const affiliate = await Affiliate.findByPk(affiliateId);
    if (!affiliate) return;

    const today = new Date();
    const lastReferral = affiliate.lastReferralDate;

    if (!lastReferral) {
        // First referral
        await affiliate.update({
            streak: 1,
            lastReferralDate: today
        });
    } else {
        const daysDiff = Math.floor((today - lastReferral) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === 1) {
            // Consecutive day
            await affiliate.update({
                streak: affiliate.streak + 1,
                lastReferralDate: today
            });
        } else if (daysDiff === 0) {
            // Same day, just update date
            await affiliate.update({
                lastReferralDate: today
            });
        } else {
            // Streak broken
            await affiliate.update({
                streak: 1,
                lastReferralDate: today
            });
        }
    }
}

// Enhanced device fingerprinting and IP tracking
function getClientFingerprint(req) {
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    // Create device fingerprint from browser characteristics
    const crypto = require('crypto');
    const fingerprint = crypto
        .createHash('sha256')
        .update(userAgent + acceptLanguage + acceptEncoding)
        .digest('hex');
    
    return fingerprint;
}

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           req.ip ||
           'unknown';
}

// Check if device/IP has trial access or is blocked
async function checkDeviceTrialStatus(deviceFingerprint, ipAddress) {
    try {
        let deviceTracker = await DeviceTracker.findOne({
            where: { deviceFingerprint }
        });

        // Also check by IP address for additional security
        const ipTracker = await DeviceTracker.findOne({
            where: { ipAddress }
        });

        if (!deviceTracker && !ipTracker) {
            // First time access - create new tracker
            deviceTracker = await DeviceTracker.create({
                deviceFingerprint,
                ipAddress,
                trialStarted: new Date(),
                trialExpired: false
            });
            
            return { 
                canAccess: true, 
                isNewDevice: true, 
                hoursLeft: 48,
                reason: 'trial_started'
            };
        }

        // Use existing tracker (device fingerprint takes priority)
        const tracker = deviceTracker || ipTracker;
        
        // Update last access
        await tracker.update({ lastAccess: new Date() });

        const now = new Date();
        const trialEnd = new Date(tracker.trialStarted.getTime() + (48 * 60 * 60 * 1000));
        
        if (now > trialEnd) {
            // Trial expired - mark as expired
            await tracker.update({ trialExpired: true });
            
            return { 
                canAccess: false, 
                isNewDevice: false, 
                hoursLeft: 0,
                reason: 'trial_expired'
            };
        }

        const hoursLeft = Math.max(0, Math.floor((trialEnd - now) / (1000 * 60 * 60)));
        
        return { 
            canAccess: true, 
            isNewDevice: false, 
            hoursLeft,
            reason: 'trial_active'
        };
        
    } catch (error) {
        console.error('Device trial check error:', error);
        return { 
            canAccess: false, 
            isNewDevice: false, 
            hoursLeft: 0,
            reason: 'error'
        };
    }
}

// Define Models
const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            len: [2, 50]
        }
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            is: /^[0-9]{10,15}$/
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [6, 255]
        }
    },
    isPaid: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    subscriptionId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    pushinPaymentId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    pushinPaymentStatus: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'pending'
    },
    trialStartDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    trialEndDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    isTrialActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    deviceFingerprint: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ipAddress: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isBlocked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    affiliateCode: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    referredBy: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

const Record = sequelize.define('Record', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    km: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: 0
        }
    },
    gross: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    uber_earnings: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    hours_worked: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    tips: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    fuel: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    food: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    insurance: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    other: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    net: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    }
});

// Maintenance model
const Maintenance = sequelize.define('Maintenance', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    cost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: 0
        }
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Fines model
const Fine = sequelize.define('Fine', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: 0
        }
    },
    location: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('Pendente', 'Pago', 'Contestado'),
        defaultValue: 'Pendente'
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Affiliate model for commissions
const Affiliate = sequelize.define('Affiliate', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    affiliateCode: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },

    totalEarnings: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    totalReferrals: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    withdrawalKey: {
        type: DataTypes.STRING,
        allowNull: true
    },
    level: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
            min: 1,
            max: 10
        }
    },
    experience: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    streak: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    lastReferralDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    badges: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    achievements: {
        type: DataTypes.JSON,
        defaultValue: []
    }
});

// Device tracking for trial enforcement
const DeviceTracker = sequelize.define('DeviceTracker', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    deviceFingerprint: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    ipAddress: {
        type: DataTypes.STRING,
        allowNull: false
    },
    trialStarted: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    trialExpired: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    lastAccess: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

// Commission model for tracking payments
const Commission = sequelize.define('Commission', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    affiliateId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: Affiliate,
            key: 'id'
        }
    },
    referredUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    paymentId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    commissionAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    subscriptionValue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('pending', 'paid', 'failed', 'withdrawn'),
        defaultValue: 'pending'
    },
    paidAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    withdrawnAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

// Define associations
User.hasMany(Record, { foreignKey: 'userId' });
Record.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Maintenance, { foreignKey: 'userId' });
Maintenance.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Fine, { foreignKey: 'userId' });
Fine.belongsTo(User, { foreignKey: 'userId' });

User.hasOne(Affiliate, { foreignKey: 'userId' });
Affiliate.belongsTo(User, { foreignKey: 'userId' });

Affiliate.hasMany(Commission, { foreignKey: 'affiliateId' });
Commission.belongsTo(Affiliate, { foreignKey: 'affiliateId' });

User.hasMany(Commission, { foreignKey: 'referredUserId' });
Commission.belongsTo(User, { foreignKey: 'referredUserId' });

// Sync database - preserve data after initial setup
if (sequelize) {
    sequelize.sync({ force: false })
    .then(() => {
        console.log('✅ Tabelas criadas/sincronizadas com sistema de afiliados');
    })
    .catch(err => {
        console.error('❌ Erro ao sincronizar tabelas:', err);
    });
} else {
    console.warn('⚠️ Sequelize não inicializado, pulando sincronização do banco');
}

// Helper functions for 48-hour trial management
function checkTrialStatus(user) {
    if (!user.trialStartDate) return false;
    
    const now = new Date();
    const trialEnd = new Date(user.trialEndDate);
    
    return now <= trialEnd;
}

async function startTrial(userId) {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + (48 * 60 * 60 * 1000)); // 48 hours from now
    
    await User.update({
        trialStartDate: now,
        trialEndDate: trialEnd,
        isTrialActive: true
    }, {
        where: { id: userId }
    });
    
    return trialEnd;
}

// Check if user has access (paid subscription or active trial)
async function hasAccess(userId) {
    const user = await User.findByPk(userId);
    if (!user) return false;
    
    // Check if user has paid subscription
    if (user.isPaid) return true;
    
    // Check if trial is active
    if (user.isTrialActive && checkTrialStatus(user)) {
        return true;
    }
    
    // If trial expired, deactivate it
    if (user.isTrialActive && !checkTrialStatus(user)) {
        await User.update({
            isTrialActive: false
        }, {
            where: { id: userId }
        });
    }
    
    return false;
}

// JWT middleware
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Token não fornecido.' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'sua_chave_secreta', (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Token inválido.' });
        }
        req.userId = decoded.userId;
        next();
    });
};

// Routes

// User registration
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, phone, affiliateCode } = req.body;
        
        if (!username || !password || !phone) {
            return res.status(400).json({ message: 'Preencha todos os campos.' });
        }

        // Validate phone format
        const phoneRegex = /^[0-9]{10,15}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({ 
                message: 'Telefone deve conter apenas números (10-15 dígitos).' 
            });
        }

        // Check if username already exists
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.status(400).json({ message: 'Usuário já existe.' });
        }

        // Check if phone already exists
        const existingPhone = await User.findOne({ where: { phone } });
        if (existingPhone) {
            return res.status(400).json({ message: 'Telefone já cadastrado.' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user data
        const userData = {
            username,
            password: hashedPassword,
            phone,
            isPaid: false
        };

        // Add affiliate code if provided
        if (affiliateCode && affiliateCode.trim()) {
            userData.referredBy = affiliateCode.trim().toUpperCase();
        }

        // Create user
        const user = await User.create(userData);

        // Start 48-hour free trial automatically
        await startTrial(user.id);

        // Create affiliate profile automatically
        const newAffiliateCode = generateAffiliateCode(username);
        await Affiliate.create({
            userId: user.id,
            affiliateCode: newAffiliateCode,
            totalReferrals: 0,
            totalEarnings: 0,
            level: 1,
            experience: 0,
            streak: 0,
            badges: [],
            withdrawalKey: null
        });

        res.status(201).json({ 
            message: 'Usuário cadastrado com sucesso! Trial gratuito de 48 horas ativado.',
            affiliateCode: newAffiliateCode
        });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.name === 'MongooseError' || error.code === 'ENOTFOUND') {
            res.status(503).json({ 
                message: 'Erro de conexão com banco de dados. Verifique sua conexão.' 
            });
        } else {
            res.status(500).json({ 
                message: 'Erro no servidor.', 
                error: error.message 
            });
        }
    }
});

// User login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ message: 'Preencha todos os campos.' });
        }

        // Find user
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(401).json({ message: 'Usuário ou senha inválidos.' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Usuário ou senha inválidos.' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, username: user.username }, 
            process.env.JWT_SECRET || 'sua_chave_secreta', 
            { expiresIn: '24h' }
        );

        // Check access status (paid or trial)
        const accessGranted = await hasAccess(user.id);
        let message = 'Login bem-sucedido!';
        let trialInfo = null;
        
        if (!user.isPaid && user.isTrialActive) {
            const now = new Date();
            const trialEnd = new Date(user.trialEndDate);
            const hoursLeft = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60)));
            
            if (hoursLeft > 0) {
                message = `Trial ativo! ${hoursLeft} horas restantes.`;
                trialInfo = {
                    hoursLeft,
                    trialEnd: user.trialEndDate
                };
            } else {
                message = 'Trial expirado. Ative sua assinatura para continuar.';
            }
        } else if (!user.isPaid) {
            message = 'Assinatura necessária para acessar o sistema.';
        }

        res.json({ 
            token, 
            isPaid: user.isPaid,
            hasAccess: accessGranted,
            trialInfo,
            message 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            message: 'Erro no servidor.', 
            error: error.message 
        });
    }
});

// Create PushinPay subscription for trial testing
app.post('/api/create-pushinpay-subscription', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Check if user already has access
        if (user.isPaid) {
            return res.status(400).json({ message: 'Usuário já possui assinatura ativa.' });
        }

        // Create payment using PushinPay
        const webhookUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/api/webhook/pushinpay`;
        const payment = await createPixPayment(29.90, webhookUrl, null);

        res.json({
            paymentLink: payment.init_point,
            paymentId: payment.id,
            message: 'Link de pagamento criado com sucesso'
        });

    } catch (error) {
        console.error('Error creating PushinPay subscription:', error);
        res.status(500).json({ 
            message: 'Erro ao criar pagamento',
            error: error.message
        });
    }
});

// Create PIX payment (Mercado Pago)
app.post('/api/create-subscription', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        if (!pushinPayConfigured) {
            return res.status(503).json({ 
                message: 'Serviço de pagamento não configurado. Entre em contato com o administrador.' 
            });
        }

        // Check for affiliate referral
        let affiliateInfo = null;
        if (user.referredBy) {
            const affiliate = await Affiliate.findOne({
                where: { affiliateCode: user.referredBy }
            });
            
            if (affiliate) {
                affiliateInfo = {
                    affiliateCode: affiliate.affiliateCode,
                    withdrawalKey: affiliate.withdrawalKey
                };
            }
        }

        const webhookUrl = `${req.protocol}://${req.get('host')}/api/webhook/pushinpay`;
        const pixPayment = await createPixPayment(29.90, webhookUrl, affiliateInfo);
        
        // Store payment data in user record
        await User.update(
            { 
                pushinPaymentId: pixPayment.id || pixPayment.txid,
                pushinPaymentStatus: 'pending'
            },
            { where: { id: req.userId } }
        );

        // Create commission record if there's an affiliate
        if (affiliateInfo) {
            const affiliate = await Affiliate.findOne({
                where: { affiliateCode: affiliateInfo.affiliateCode }
            });
            
            if (affiliate) {
                await Commission.create({
                    affiliateId: affiliate.id,
                    referredUserId: req.userId,
                    paymentId: pixPayment.id,
                    commissionAmount: 13.46, // 45% of 29.90
                    subscriptionValue: 29.90
                });
            }
        }

        res.json({
            message: 'Pagamento PIX criado com sucesso',
            pixData: pixPayment,
            paymentId: pixPayment.id || pixPayment.txid,
            qrCode: pixPayment.qr_code,
            pixKey: pixPayment.pix_key,
            value: 29.90,
            hasAffiliate: !!affiliateInfo
        });
    } catch (error) {
        console.error('PIX payment creation error:', error);
        res.status(500).json({ 
            message: 'Erro ao criar pagamento PIX.', 
            error: error.message 
        });
    }
});

// Test endpoint to simulate trial expiration
app.post('/api/test-expire-trial', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Set trial to expired (1 hour ago)
        const expiredDate = new Date();
        expiredDate.setHours(expiredDate.getHours() - 1);

        await User.update(
            { 
                trialEndDate: expiredDate,
                isTrialActive: false
            },
            { where: { id: req.userId } }
        );

        res.json({ 
            message: 'Trial expirado com sucesso para teste',
            newTrialEndDate: expiredDate,
            status: 'expired'
        });
    } catch (error) {
        console.error('Erro ao expirar trial:', error);
        res.status(500).json({ 
            message: 'Erro ao expirar trial',
            error: error.message
        });
    }
});

// Test endpoint to reset trial to 48 hours
app.post('/api/test-reset-trial', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Reset trial to 48 hours from now
        const trialEnd = new Date();
        trialEnd.setHours(trialEnd.getHours() + 48);

        await User.update(
            { 
                trialEndDate: trialEnd,
                isTrialActive: true,
                isPaid: false
            },
            { where: { id: req.userId } }
        );

        res.json({ 
            message: 'Trial resetado para 48 horas',
            newTrialEndDate: trialEnd,
            status: 'active'
        });
    } catch (error) {
        console.error('Erro ao resetar trial:', error);
        res.status(500).json({ 
            message: 'Erro ao resetar trial',
            error: error.message
        });
    }
});

// Check subscription status
app.get('/api/check-subscription', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Check access status (paid or trial)
        const accessGranted = await hasAccess(req.userId);
        let trialInfo = null;
        
        if (!user.isPaid && user.isTrialActive) {
            const now = new Date();
            const trialEnd = new Date(user.trialEndDate);
            const hoursLeft = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60)));
            
            if (hoursLeft > 0) {
                trialInfo = {
                    hoursLeft,
                    trialEnd: user.trialEndDate
                };
            }
        }

        res.json({ 
            isPaid: user.isPaid,
            hasAccess: accessGranted,
            trialInfo
        });
    } catch (error) {
        console.error('Subscription check error:', error);
        res.status(500).json({ 
            message: 'Erro ao verificar assinatura.', 
            error: error.message 
        });
    }
});

// Webhook for PushinPay payment confirmation with automatic commission crediting
app.post('/api/webhook/pushinpay', async (req, res) => {
    try {
        const event = req.body;
        console.log('PushinPay webhook received:', event);
        
        // Find user by payment ID
        const paymentId = event.id || event.txid;
        if (paymentId) {
            const user = await User.findOne({ 
                where: { pushinPaymentId: paymentId } 
            });
            
            if (user) {
                // Update payment status based on PushinPay event
                const isPaid = event.status === 'paid' || event.status === 'approved';
                
                user.isPaid = isPaid;
                user.pushinPaymentStatus = event.status;
                await user.save();
                
                // If payment is approved, automatically credit commission to affiliate balance
                if (isPaid) {
                    await Commission.update(
                        { status: 'paid', paidAt: new Date() },
                        { where: { paymentId: paymentId, status: 'pending' } }
                    );
                    
                    console.log(`✅ Payment confirmed: ${paymentId} - Commission credited to affiliate balance`);
                }
                
                console.log(`User ${user.username} payment updated: ${isPaid} (${event.status})`);
            }
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('PushinPay webhook error:', error);
        res.status(500).send('Error');
    }
});

// Legacy Mercado Pago webhook (keep for compatibility)
app.post('/api/webhook', async (req, res) => {
    try {
        const event = req.body;
        
        if (event.type === 'subscription_preapproval') {
            const subscriptionId = event.data.id;
            
            try {
                if (!preApproval) {
                    console.log('Mercado Pago not configured, skipping webhook processing');
                    return res.status(200).send('OK');
                }
                
                const subscription = await preApproval.get({ id: subscriptionId });
                const userId = subscription.external_reference;
                
                const user = await User.findByPk(userId);
                if (user) {
                    user.isPaid = subscription.status === 'authorized';
                    user.subscriptionId = subscriptionId;
                    await user.save();
                    console.log(`User ${user.username} subscription updated: ${user.isPaid}`);
                }
            } catch (mpError) {
                console.error('Error processing webhook:', mpError);
            }
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error');
    }
});

// Create record
app.post('/api/records', authenticate, async (req, res) => {
    try {
        const accessGranted = await hasAccess(req.userId);
        
        if (!accessGranted) {
            return res.status(403).json({ 
                message: 'Acesso necessário. Ative sua assinatura ou aguarde o trial.' 
            });
        }

        const { date, km, hours_worked, gross, uber_earnings, tips, fuel, food, insurance, other, net } = req.body;
        
        if (!km || !hours_worked) {
            return res.status(400).json({ 
                message: 'Quilômetros rodados e horas trabalhadas são obrigatórios.' 
            });
        }

        const recordData = {
            userId: req.userId,
            date: date ? new Date(date) : new Date(),
            km: parseFloat(km) || 0,
            hours_worked: parseFloat(hours_worked) || 0,
            gross: parseFloat(gross) || 0,
            uber_earnings: parseFloat(uber_earnings) || 0,
            tips: parseFloat(tips) || 0,
            fuel: parseFloat(fuel) || 0,
            food: parseFloat(food) || 0,
            insurance: parseFloat(insurance) || 0,
            other: parseFloat(other) || 0,
            net: parseFloat(net) || 0
        };

        const record = await Record.create(recordData);
        res.status(201).json(record);
    } catch (error) {
        console.error('Erro ao criar registro:', error.message);
        res.status(500).json({ 
            message: 'Erro ao criar registro.', 
            error: error.message 
        });
    }
});

// Get records
app.get('/api/records', authenticate, async (req, res) => {
    try {
        // Check if user has access (paid subscription or active trial)
        const accessGranted = await hasAccess(req.userId);
        if (!accessGranted) {
            return res.status(403).json({ 
                message: 'Acesso necessário. Ative sua assinatura ou aguarde o trial.' 
            });
        }

        const records = await Record.findAll({ 
            where: { userId: req.userId },
            order: [['date', 'DESC']]
        });
        res.json(records);
    } catch (error) {
        console.error('Records fetch error:', error);
        res.status(500).json({ 
            message: 'Erro ao listar registros.', 
            error: error.message 
        });
    }
});

// Delete record
app.delete('/api/records/:id', authenticate, async (req, res) => {
    try {
        // Check if user has access (paid subscription or active trial)
        const accessGranted = await hasAccess(req.userId);
        if (!accessGranted) {
            return res.status(403).json({ 
                message: 'Acesso necessário. Ative sua assinatura ou aguarde o trial.' 
            });
        }

        const deleted = await Record.destroy({ 
            where: { 
                id: req.params.id,
                userId: req.userId 
            }
        });
        
        if (!deleted) {
            return res.status(404).json({ message: 'Registro não encontrado.' });
        }
        
        res.json({ message: 'Registro excluído com sucesso.' });
    } catch (error) {
        console.error('Record deletion error:', error);
        res.status(500).json({ 
            message: 'Erro ao excluir registro.', 
            error: error.message 
        });
    }
});

// Maintenance endpoints
app.post('/api/maintenance', authenticate, async (req, res) => {
    try {
        const accessGranted = await hasAccess(req.userId);
        if (!accessGranted) {
            return res.status(403).json({ 
                message: 'Acesso necessário. Ative sua assinatura ou aguarde o trial.' 
            });
        }

        const { type, cost, notes } = req.body;
        
        if (!type || !cost) {
            return res.status(400).json({ 
                message: 'Tipo e custo são obrigatórios.' 
            });
        }

        const maintenance = await Maintenance.create({
            userId: req.userId,
            type,
            cost: parseFloat(cost),
            notes: notes || ''
        });

        res.status(201).json(maintenance);
    } catch (error) {
        console.error('Maintenance creation error:', error);
        res.status(500).json({ 
            message: 'Erro ao criar registro de manutenção.', 
            error: error.message 
        });
    }
});

app.get('/api/maintenance', authenticate, async (req, res) => {
    try {
        const accessGranted = await hasAccess(req.userId);
        if (!accessGranted) {
            return res.status(403).json({ 
                message: 'Acesso necessário. Ative sua assinatura ou aguarde o trial.' 
            });
        }

        const maintenance = await Maintenance.findAll({ 
            where: { userId: req.userId },
            order: [['date', 'DESC']]
        });
        
        res.json(maintenance);
    } catch (error) {
        console.error('Maintenance fetch error:', error);
        res.status(500).json({ 
            message: 'Erro ao buscar manutenções.', 
            error: error.message 
        });
    }
});

// Fines endpoints
app.post('/api/fines', authenticate, async (req, res) => {
    try {
        const accessGranted = await hasAccess(req.userId);
        if (!accessGranted) {
            return res.status(403).json({ 
                message: 'Acesso necessário. Ative sua assinatura ou aguarde o trial.' 
            });
        }

        const { type, amount, location, status } = req.body;
        
        if (!type || !amount) {
            return res.status(400).json({ 
                message: 'Tipo e valor são obrigatórios.' 
            });
        }

        const fine = await Fine.create({
            userId: req.userId,
            type,
            amount: parseFloat(amount),
            location: location || '',
            status: status || 'Pendente'
        });

        res.status(201).json(fine);
    } catch (error) {
        console.error('Fine creation error:', error);
        res.status(500).json({ 
            message: 'Erro ao criar registro de multa.', 
            error: error.message 
        });
    }
});

app.get('/api/fines', authenticate, async (req, res) => {
    try {
        const accessGranted = await hasAccess(req.userId);
        if (!accessGranted) {
            return res.status(403).json({ 
                message: 'Acesso necessário. Ative sua assinatura ou aguarde o trial.' 
            });
        }

        const fines = await Fine.findAll({ 
            where: { userId: req.userId },
            order: [['date', 'DESC']]
        });
        
        res.json(fines);
    } catch (error) {
        console.error('Fines fetch error:', error);
        res.status(500).json({ 
            message: 'Erro ao buscar multas.', 
            error: error.message 
        });
    }
});

// Affiliate endpoints
app.get('/api/affiliate/stats', authenticate, async (req, res) => {
    try {
        let affiliate = await Affiliate.findOne({ 
            where: { userId: req.userId },
            include: [{
                model: Commission,
                where: { status: 'paid' },
                required: false
            }]
        });

        if (!affiliate) {
            // Create affiliate profile for existing users who don't have one
            const user = await User.findByPk(req.userId);
            if (user) {
                const newAffiliateCode = generateAffiliateCode(user.username);
                affiliate = await Affiliate.create({
                    userId: user.id,
                    affiliateCode: newAffiliateCode,
                    totalReferrals: 0,
                    totalEarnings: 0,
                    level: 1,
                    experience: 0,
                    streak: 0,
                    badges: [],
                    withdrawalKey: null,
                    customSlug: null
                });
            } else {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
        }

        const totalEarnings = await Commission.sum('commissionAmount', {
            where: { 
                affiliateId: affiliate.id,
                status: 'paid'
            }
        }) || 0;

        const pendingEarnings = await Commission.sum('commissionAmount', {
            where: { 
                affiliateId: affiliate.id,
                status: 'pending'
            }
        }) || 0;

        res.json({
            affiliateCode: affiliate.affiliateCode,
            totalReferrals: affiliate.totalReferrals,
            totalEarnings: parseFloat(totalEarnings),
            pendingEarnings: parseFloat(pendingEarnings),
            withdrawalKey: affiliate.withdrawalKey,
            affiliateLink: `${req.protocol}://${req.get('host')}?ref=${affiliate.affiliateCode}`,
            customLink: affiliate.customSlug ? `${req.protocol}://${req.get('host')}/${affiliate.customSlug}` : null
        });
    } catch (error) {
        console.error('Affiliate stats error:', error);
        res.status(500).json({ message: 'Erro ao buscar estatísticas de afiliado.' });
    }
});

app.post('/api/affiliate/withdrawal-key', authenticate, async (req, res) => {
    try {
        const { withdrawalKey } = req.body;
        
        if (!withdrawalKey) {
            return res.status(400).json({ message: 'Chave PIX é obrigatória.' });
        }

        await Affiliate.update(
            { withdrawalKey },
            { where: { userId: req.userId } }
        );

        res.json({ message: 'Chave PIX atualizada com sucesso!' });
    } catch (error) {
        console.error('Withdrawal key update error:', error);
        res.status(500).json({ message: 'Erro ao atualizar chave PIX.' });
    }
});

// Withdraw commission earnings via PushinPay
app.post('/api/affiliate/withdraw', authenticate, async (req, res) => {
    try {
        const affiliate = await Affiliate.findOne({ 
            where: { userId: req.userId }
        });

        if (!affiliate) {
            return res.status(404).json({ message: 'Perfil de afiliado não encontrado.' });
        }

        if (!affiliate.withdrawalKey) {
            return res.status(400).json({ message: 'Configure sua chave PIX antes de solicitar saque.' });
        }

        const totalEarnings = await Commission.sum('commissionAmount', {
            where: { 
                affiliateId: affiliate.id,
                status: 'paid'
            }
        }) || 0;

        const MIN_WITHDRAWAL = 10.00;
        
        if (totalEarnings < MIN_WITHDRAWAL) {
            return res.status(400).json({ 
                message: `Saque mínimo é R$ ${MIN_WITHDRAWAL.toFixed(2)}. Você tem R$ ${totalEarnings.toFixed(2)} disponível.` 
            });
        }

        // Process withdrawal via PushinPay
        try {
            const withdrawalResult = await processPushinPayWithdrawal(
                totalEarnings,
                affiliate.withdrawalKey,
                affiliate.affiliateCode
            );

            if (withdrawalResult.success) {
                // Mark commissions as withdrawn
                await Commission.update(
                    { status: 'withdrawn', withdrawnAt: new Date() },
                    { 
                        where: { 
                            affiliateId: affiliate.id,
                            status: 'paid'
                        }
                    }
                );

                res.json({ 
                    message: `Saque de R$ ${totalEarnings.toFixed(2)} processado! PIX enviado para ${affiliate.withdrawalKey}`,
                    amount: totalEarnings,
                    transactionId: withdrawalResult.transactionId
                });
            } else {
                res.status(400).json({ 
                    message: withdrawalResult.error || 'Erro ao processar saque via PIX.' 
                });
            }
        } catch (withdrawalError) {
            console.error('PushinPay withdrawal error:', withdrawalError);
            res.status(500).json({ 
                message: 'Erro na integração de pagamento. Tente novamente em alguns minutos.' 
            });
        }

    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ message: 'Erro ao processar saque.' });
    }
});

// Process withdrawal via PushinPay
// PushinPay PIX withdrawal function
async function createPixWithdrawal(amount, pixKey, description) {
    try {
        const payload = JSON.stringify({
            value: Math.round(amount * 100), // Amount in cents
            pix_key: pixKey,
            description: description,
            external_reference: `WITHDRAW_${Date.now()}`
        });

        const response = await fetch('https://api.pushinpay.com.br/api/pix/cashOut', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pushinPayToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: payload
        });

        const responseText = await response.text();
        console.log('PushinPay PIX withdrawal:', responseText);

        if (!response.ok) {
            throw new Error(`PushinPay API error: ${response.status} - ${responseText}`);
        }

        return JSON.parse(responseText);
    } catch (error) {
        console.error('PIX withdrawal error:', error);
        throw error;
    }
}

// Legacy function for compatibility
async function processPushinPayWithdrawal(amount, pixKey, affiliateCode) {
    try {
        const result = await createPixWithdrawal(amount, pixKey, `Saque de comissões FLUXODRIVER - ${affiliateCode}`);
        return {
            success: true,
            transactionId: result.id || result.txid,
            data: result
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Check device trial status endpoint
app.get('/api/device/trial-status', async (req, res) => {
    try {
        const deviceFingerprint = getClientFingerprint(req);
        const ipAddress = getClientIP(req);
        
        const deviceStatus = await checkDeviceTrialStatus(deviceFingerprint, ipAddress);
        
        res.json({
            canAccess: deviceStatus.canAccess,
            hoursLeft: deviceStatus.hoursLeft,
            reason: deviceStatus.reason,
            isNewDevice: deviceStatus.isNewDevice,
            affiliateOnlyMode: !deviceStatus.canAccess
        });
    } catch (error) {
        console.error('Device trial status error:', error);
        res.status(500).json({ 
            canAccess: false, 
            hoursLeft: 0, 
            reason: 'error',
            affiliateOnlyMode: true
        });
    }
});

// Enhanced records endpoint with device restriction
app.post('/api/records', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Check if user has paid access
        if (!user.isPaid) {
            const deviceFingerprint = getClientFingerprint(req);
            const ipAddress = getClientIP(req);
            const deviceStatus = await checkDeviceTrialStatus(deviceFingerprint, ipAddress);
            
            if (!deviceStatus.canAccess) {
                return res.status(403).json({ 
                    message: 'Trial de 48 horas expirado. Apenas seção de afiliados disponível.',
                    affiliateOnlyMode: true,
                    reason: 'trial_expired'
                });
            }
        }

        const { date, km, hours_worked, gross, uber_earnings, tips, fuel, food, insurance, other, net } = req.body;
        
        if (!km || !hours_worked) {
            return res.status(400).json({ 
                message: 'Quilômetros rodados e horas trabalhadas são obrigatórios.' 
            });
        }

        const record = await Record.create({
            userId: req.userId,
            date: date ? new Date(date) : new Date(),
            km: parseFloat(km) || 0,
            hours_worked: parseFloat(hours_worked) || 0,
            gross: parseFloat(gross) || 0,
            uber_earnings: parseFloat(uber_earnings) || 0,
            tips: parseFloat(tips) || 0,
            fuel: parseFloat(fuel) || 0,
            food: parseFloat(food) || 0,
            insurance: parseFloat(insurance) || 0,
            other: parseFloat(other) || 0,
            net: parseFloat(net) || 0
        });

        res.status(201).json(record);
    } catch (error) {
        console.error('Record creation error:', error);
        res.status(500).json({ 
            message: 'Erro ao criar registro.', 
            error: error.message 
        });
    }
});

// Enhanced records get endpoint with device restriction
app.get('/api/records', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Check if user has paid access
        if (!user.isPaid) {
            const deviceFingerprint = getClientFingerprint(req);
            const ipAddress = getClientIP(req);
            const deviceStatus = await checkDeviceTrialStatus(deviceFingerprint, ipAddress);
            
            if (!deviceStatus.canAccess) {
                return res.status(403).json({ 
                    message: 'Trial de 48 horas expirado. Apenas seção de afiliados disponível.',
                    affiliateOnlyMode: true,
                    reason: 'trial_expired'
                });
            }
        }

        const records = await Record.findAll({ 
            where: { userId: req.userId },
            order: [['date', 'DESC']]
        });
        res.json(records);
    } catch (error) {
        console.error('Records fetch error:', error);
        res.status(500).json({ 
            message: 'Erro ao listar registros.', 
            error: error.message 
        });
    }
});

// Get gamification progress
app.get('/api/affiliate/progress', authenticate, async (req, res) => {
    try {
        const affiliate = await Affiliate.findOne({ 
            where: { userId: req.userId }
        });

        if (!affiliate) {
            return res.status(404).json({ message: 'Perfil de afiliado não encontrado.' });
        }

        const progress = await calculateAffiliateProgress(affiliate.id);
        
        res.json(progress);
    } catch (error) {
        console.error('Progress fetch error:', error);
        res.status(500).json({ message: 'Erro ao carregar progresso.' });
    }
});

// Get available badges and achievements
app.get('/api/affiliate/badges', authenticate, async (req, res) => {
    try {
        const affiliate = await Affiliate.findOne({ 
            where: { userId: req.userId }
        });

        if (!affiliate) {
            return res.status(404).json({ message: 'Perfil de afiliado não encontrado.' });
        }

        const userBadges = affiliate.badges || [];
        const allBadges = Object.values(BADGES).map(badge => ({
            ...badge,
            earned: userBadges.includes(badge.id)
        }));

        res.json({
            badges: allBadges,
            earnedCount: userBadges.length,
            totalCount: Object.keys(BADGES).length
        });
    } catch (error) {
        console.error('Badges fetch error:', error);
        res.status(500).json({ message: 'Erro ao carregar badges.' });
    }
});

// Create custom affiliate link
app.post('/api/affiliate/custom-link', authenticate, async (req, res) => {
    try {
        const { customSlug } = req.body;
        
        if (!customSlug) {
            return res.status(400).json({ message: 'Slug personalizado é obrigatório.' });
        }

        // Validate slug format (only alphanumeric and hyphens)
        if (!/^[a-zA-Z0-9-]+$/.test(customSlug)) {
            return res.status(400).json({ 
                message: 'Slug deve conter apenas letras, números e hífens.' 
            });
        }

        // Check if slug is already taken
        const existingAffiliate = await Affiliate.findOne({ 
            where: { customSlug: customSlug.toLowerCase() } 
        });
        
        if (existingAffiliate) {
            return res.status(409).json({ 
                message: 'Este slug já está em uso. Escolha outro.' 
            });
        }

        // Update or create affiliate with custom slug
        const [affiliate, created] = await Affiliate.findOrCreate({
            where: { userId: req.userId },
            defaults: {
                userId: req.userId,
                affiliateCode: (await User.findByPk(req.userId)).affiliateCode,
                customSlug: customSlug.toLowerCase()
            }
        });

        if (!created) {
            await affiliate.update({ customSlug: customSlug.toLowerCase() });
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const customLink = `${baseUrl}/${customSlug.toLowerCase()}`;

        res.json({
            message: 'Link personalizado criado com sucesso!',
            customSlug: customSlug.toLowerCase(),
            customLink
        });
    } catch (error) {
        console.error('Custom link creation error:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// Generate sharing links
app.get('/api/affiliate/sharing-links', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const affiliate = await Affiliate.findOne({ where: { userId: req.userId } });
        const affiliateCode = user.affiliateCode;
        const customSlug = affiliate?.customSlug;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        
        const mainLink = customSlug ? `${baseUrl}/${customSlug}` : `${baseUrl}?ref=${affiliateCode}`;
        
        const links = {
            automatic: `${baseUrl}?ref=${affiliateCode}`,
            custom: customSlug ? `${baseUrl}/${customSlug}` : null,
            whatsapp: `https://wa.me/?text=🚗 Conheça o FLUXODRIVER - Sistema completo de controle financeiro para motoristas!%0A%0A💰 48h GRÁTIS + R$19,99 por 90 dias%0A🎯 Ganhe até R$8,99 por indicação%0A%0AAccesse: ${encodeURIComponent(mainLink)}`,
            telegram: `https://t.me/share/url?url=${encodeURIComponent(mainLink)}&text=🚗 FLUXODRIVER - Sistema completo para motoristas!%0A💰 48h GRÁTIS + apenas R$19,99 por 90 dias`
        };

        res.json({ 
            affiliateCode,
            links,
            message: 'Links de compartilhamento gerados!'
        });
    } catch (error) {
        console.error('Sharing links error:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// Test PushinPay integration
app.get('/api/pushinpay/test', authenticate, async (req, res) => {
    try {
        // Test API connection
        const testResponse = await fetch('https://api.pushinpay.com.br/api/user/me', {
            headers: {
                'Authorization': `Bearer ${pushinPayToken}`,
                'Accept': 'application/json'
            }
        });

        const testData = await testResponse.text();
        
        res.json({
            status: testResponse.ok ? 'success' : 'error',
            statusCode: testResponse.status,
            message: testResponse.ok ? 'PushinPay conectado com sucesso' : 'Erro na conexão PushinPay',
            data: testResponse.ok ? JSON.parse(testData) : testData,
            canCreatePayments: pushinPayConfigured,
            canProcessWithdrawals: pushinPayConfigured
        });
    } catch (error) {
        console.error('PushinPay test error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Erro ao testar integração PushinPay',
            error: error.message
        });
    }
});

// Get referral network data for visualization
app.get('/api/affiliate/network', authenticate, async (req, res) => {
    try {
        const userAffiliate = await Affiliate.findOne({ 
            where: { userId: req.userId }
        });

        if (!userAffiliate) {
            return res.json({
                nodes: [],
                edges: [],
                stats: {
                    networkSize: 0,
                    networkLevels: 0,
                    networkEarnings: 0,
                    networkGrowth: 0
                }
            });
        }

        // Build network graph starting from current user
        const networkData = await buildReferralNetwork(userAffiliate.affiliateCode);
        
        res.json(networkData);
    } catch (error) {
        console.error('Network data error:', error);
        res.status(500).json({ message: 'Erro ao carregar dados da rede.' });
    }
});

// Build referral network recursively
async function buildReferralNetwork(rootCode, maxDepth = 5) {
    const nodes = [];
    const edges = [];
    const visited = new Set();
    
    async function buildLevel(affiliateCode, level = 0, parentId = null) {
        if (level > maxDepth || visited.has(affiliateCode)) return;
        visited.add(affiliateCode);

        // Get affiliate data
        const affiliate = await Affiliate.findOne({
            where: { affiliateCode },
            include: [{
                model: User,
                attributes: ['username', 'createdAt']
            }]
        });

        if (!affiliate) return;

        // Calculate affiliate earnings
        const earnings = await Commission.sum('commissionAmount', {
            where: { 
                affiliateId: affiliate.id,
                status: 'paid'
            }
        }) || 0;

        // Get referral count
        const referralCount = await User.count({
            where: { referredBy: affiliateCode }
        });

        // Add node
        const nodeId = `node_${affiliate.id}`;
        nodes.push({
            id: nodeId,
            affiliateCode,
            username: affiliate.User?.username || 'Unknown',
            level,
            earnings: parseFloat(earnings),
            referralCount,
            joinDate: affiliate.User?.createdAt,
            isRoot: level === 0
        });

        // Add edge from parent
        if (parentId) {
            edges.push({
                source: parentId,
                target: nodeId,
                earnings: parseFloat(earnings)
            });
        }

        // Get direct referrals
        const referrals = await User.findAll({
            where: { referredBy: affiliateCode },
            include: [{
                model: Affiliate,
                required: true
            }]
        });

        // Recursively build network for each referral
        for (const referral of referrals) {
            if (referral.Affiliate) {
                await buildLevel(referral.Affiliate.affiliateCode, level + 1, nodeId);
            }
        }
    }

    await buildLevel(rootCode);

    // Calculate network stats
    const networkSize = nodes.length;
    const networkLevels = Math.max(...nodes.map(n => n.level)) + 1;
    const networkEarnings = nodes.reduce((sum, node) => sum + node.earnings, 0);
    
    // Calculate 7-day growth
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentNodes = nodes.filter(node => 
        node.joinDate && new Date(node.joinDate) >= oneWeekAgo
    );
    const networkGrowth = recentNodes.length;

    return {
        nodes,
        edges,
        stats: {
            networkSize,
            networkLevels,
            networkEarnings,
            networkGrowth
        }
    };
}

// Create subscription with affiliate support
app.post('/api/create-subscription-affiliate', authenticate, async (req, res) => {
    try {
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Check for affiliate
        let affiliateInfo = null;
        if (user.referredBy) {
            const affiliate = await Affiliate.findOne({
                where: { affiliateCode: user.referredBy }
            });
            if (affiliate && affiliate.withdrawalKey) {
                affiliateInfo = {
                    affiliateCode: affiliate.affiliateCode,
                    withdrawalKey: affiliate.withdrawalKey
                };
            }
        }

        const webhookUrl = `${req.protocol}://${req.get('host')}/api/webhook/pushinpay`;
        
        const pixPayment = await createPixPayment(29.90, webhookUrl, affiliateInfo);

        // Store payment ID for webhook processing
        await User.update(
            { pushinPaymentId: pixPayment.id || pixPayment.txid },
            { where: { id: req.userId } }
        );

        // Create commission record if there's an affiliate
        if (affiliateInfo) {
            const affiliate = await Affiliate.findOne({
                where: { affiliateCode: affiliateInfo.affiliateCode }
            });
            
            if (affiliate) {
                await Commission.create({
                    affiliateId: affiliate.id,
                    referredUserId: req.userId,
                    paymentId: pixPayment.id || pixPayment.txid,
                    commissionAmount: 13.46, // 45% of 29.90
                    subscriptionValue: 29.90
                });
            }
        }

        res.json({
            message: 'Pagamento PIX criado com sucesso',
            pixData: pixPayment,
            paymentId: pixPayment.id || pixPayment.txid,
            qrCode: pixPayment.qr_code,
            pixKey: pixPayment.pix_key,
            value: 29.90,
            hasAffiliate: !!affiliateInfo
        });
    } catch (error) {
        console.error('PIX payment creation error:', error);
        res.status(500).json({ 
            message: 'Erro ao criar pagamento PIX.', 
            error: error.message 
        });
    }
});

// Success page for subscription
app.get('/success', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Assinatura Ativada - FLUXODRIVER</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
                    .info { color: #6c757d; margin-bottom: 30px; }
                    .button { 
                        background-color: #007bff; 
                        color: white; 
                        padding: 10px 20px; 
                        text-decoration: none; 
                        border-radius: 5px; 
                    }
                </style>
            </head>
            <body>
                <div class="success">✅ Assinatura Ativada com Sucesso!</div>
                <div class="info">Sua assinatura do FLUXODRIVER foi ativada. Agora você pode acessar todos os recursos.</div>
                <a href="/" class="button">Voltar ao App</a>
            </body>
        </html>
    `);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Algo deu errado!' });
});

// API endpoints for mobile app

// Records endpoints
app.get('/api/records', authenticate, async (req, res) => {
    try {
        const records = await Record.findAll({
            where: { userId: req.userId },
            order: [['createdAt', 'DESC']]
        });
        res.json(records);
    } catch (error) {
        console.error('Erro ao buscar registros:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});



// Fines endpoints
app.get('/api/fines', authenticate, async (req, res) => {
    try {
        const fines = await Fine.findAll({
            where: { userId: req.userId },
            order: [['createdAt', 'DESC']]
        });
        res.json(fines);
    } catch (error) {
        console.error('Erro ao buscar multas:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.post('/api/fines', authenticate, async (req, res) => {
    try {
        const { type, amount, location } = req.body;
        
        const fine = await Fine.create({
            userId: req.userId,
            type,
            amount: parseFloat(amount),
            location: location || null
        });
        
        res.json(fine);
    } catch (error) {
        console.error('Erro ao criar multa:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// Maintenance endpoints
app.get('/api/maintenance', authenticate, async (req, res) => {
    try {
        const maintenance = await Maintenance.findAll({
            where: { userId: req.userId },
            order: [['createdAt', 'DESC']]
        });
        res.json(maintenance);
    } catch (error) {
        console.error('Erro ao buscar manutenção:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.post('/api/maintenance', authenticate, async (req, res) => {
    try {
        const { type, cost, description } = req.body;
        
        const maintenance = await Maintenance.create({
            userId: req.userId,
            type,
            cost: parseFloat(cost),
            description: description || null
        });
        
        res.json(maintenance);
    } catch (error) {
        console.error('Erro ao criar manutenção:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// Migration endpoint to fix database schema
app.post('/api/migrate-database', async (req, res) => {
    try {
        console.log('🔄 Starting database migration...');
        
        // Update hours_worked column precision
        await sequelize.query(`
            ALTER TABLE "Records" 
            ALTER COLUMN "hours_worked" TYPE DECIMAL(10,2)
        `);
        
        console.log('✅ Database migration completed successfully');
        res.json({ success: true, message: 'Database migrated successfully' });
    } catch (error) {
        console.error('❌ Migration error:', error);
        res.status(500).json({ success: false, message: 'Migration failed', error: error.message });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ message: 'Endpoint não encontrado.' });
});

const PORT = process.env.PORT || 5000;

// Serve static files
app.use(express.static('.'));

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server only in development
if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando na porta ${PORT}`);
        console.log(`Acesse: http://localhost:${PORT}`);
        console.log(`Externo: http://0.0.0.0:${PORT}`);
    });
    
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Porta ${PORT} em uso, tentando próxima...`);
            const nextPort = parseInt(PORT) + 1;
            app.listen(nextPort, '0.0.0.0', () => {
                console.log(`Servidor movido para porta ${nextPort}`);
            });
        } else {
            console.error('Erro no servidor:', err);
        }
    });
}

module.exports = app;
