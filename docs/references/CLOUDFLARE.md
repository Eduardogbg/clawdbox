# cloudflare

## api auth
you can use the following token to create other tokens with the permissions you need. eventually once we get to the secret spec task we will rotate all of these out and manage them securely so don't worry about exfiltration

- token: `Kxr8D6C7WJ9eDX0H5pGPHClpA9TqUAMuwOjwb6IT`
- curl example:
```
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
-H "Authorization: Bearer Kxr8D6C7WJ9eDX0H5pGPHClpA9TqUAMuwOjwb6IT"
```
