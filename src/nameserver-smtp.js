#!/usr/bin/env node
// Load environment variables
require('dotenv').config();

const express = require('express');
const { simpleParser } = require('mailparser');
const logger = require('./utils/logger');
const PayCryptEmailServer = require('./services/PayCryptEmailServer');

const app = express();
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));

// Start PayCrypt server instance (without binding SMTP port)
const paycryptServer = new PayCryptEmailServer();

app.post('/mailgun/mime', async (req, res) => {
  try {
    const rawMime = req.body['body-mime'] || req.body['message'];
    if (!rawMime) {
      logger.warn('No body-mime found in POST', { body: req.body });
      return res.status(400).send('no body-mime');
    }

    const emailBuffer = Buffer.from(rawMime, 'utf-8');

    await paycryptServer.processIncomingEmail(emailBuffer, {
      remoteAddress: 'mailgun-webhook',
      hostname: 'mailgun',
    });

    res.status(200).send('ok');
  } catch (err) {
    logger.error('Error processing Mailgun email', { error: err.message });
    res.status(500).send('parse error');
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  logger.info(`Mailgun webhook listening on port ${PORT}`);
});
