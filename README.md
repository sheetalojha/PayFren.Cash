# PayCrypt Email Server

A custom email server for the PayCrypt protocol that receives emails, parses transaction details, and manages EML files.

## Testing

To test the email server:

1. Start the server: `npm start`
2. Send a test email using a mail client or tool like `swaks`:

```bash
swaks --to test@localhost --from sender@example.com --server localhost:25 --data -
```

Then paste:
```
To: recipient@example.com
CC: send@paycrypt.xyz
Subject: Send 0.1 PYUSD to recipient@example.com

Send 0.1 PYUSD to recipient@example.com
```
