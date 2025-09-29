const config = {
  smtp: {
    port: process.env.SMTP_PORT || 2525,
    host: process.env.SMTP_HOST || '127.0.0.1',
    secure: process.env.SMTP_SECURE === 'true' || false,
    authOptional: true,
    logger: true,
    banner: 'PayCrypt Email Server v1.0.0',
    disabledCommands: ['AUTH'], // Disable authentication for now
    size: 10 * 1024 * 1024, // 10MB max email size
  },

  email: {
    allowedDomains: process.env.ALLOWED_DOMAINS ? process.env.ALLOWED_DOMAINS.split(',') : [],
    maxEmailsPerMinute: parseInt(process.env.MAX_EMAILS_PER_MINUTE) || 100,
    enableSpamFilter: process.env.ENABLE_SPAM_FILTER === 'true' || true,
    enableDkimValidation: process.env.ENABLE_DKIM_VALIDATION === 'true' || false,
    enableSpfValidation: process.env.ENABLE_SPF_VALIDATION === 'true' || false,
  },

  // Outgoing email configuration for sending replies
  outgoingEmail: {
    host: process.env.OUTGOING_SMTP_HOST || 'smtp.mailgun.org',
    port: parseInt(process.env.OUTGOING_SMTP_PORT) || 587,
    secure: process.env.OUTGOING_SMTP_SECURE === 'true' || false,
    auth: {
      user: process.env.OUTGOING_SMTP_USER || '',
      pass: process.env.OUTGOING_SMTP_PASS || ''
    },
    from: process.env.OUTGOING_EMAIL_FROM || '',
    replyTo: process.env.OUTGOING_EMAIL_REPLY_TO || ''
  },

  storage: {
    emlPath: process.env.EML_STORAGE_PATH || './storage/emails',
    maxStorageSize: parseInt(process.env.MAX_STORAGE_SIZE) || 1000 * 1024 * 1024, // 1GB
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 24 * 60 * 60 * 1000, // 24 hours
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'payfren',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
  },

  // Queue Configuration
  queue: {
    url: process.env.QUEUE_URL || 'amqp://localhost',
    exchange: process.env.QUEUE_EXCHANGE || 'payfren.emails',
    queue: process.env.QUEUE_NAME || 'email.processing',
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/paycrypt.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
  },

  security: {
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60 * 1000, 
    maxConnectionsPerIP: parseInt(process.env.MAX_CONNECTIONS_PER_IP) || 10,
    enableTLS: process.env.ENABLE_TLS === 'true' || false,
    tlsCertPath: process.env.TLS_CERT_PATH || './certs/server.crt',
    tlsKeyPath: process.env.TLS_KEY_PATH || './certs/server.key',
  }
};

module.exports = config;
