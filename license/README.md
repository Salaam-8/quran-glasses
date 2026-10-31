# Subscription keys

`public_key.txt` is built into the app (build.py) and checks subscription codes offline.

**The key here is a development key.** Its secret half is `tools/dev-license-key.json`, committed so tests
and development builds work. Anyone with this repository can issue codes for it.

Before selling, the owner creates the real key pair on their own computer:

    node tools/license.js keygen                 # secret key -> ~/.quran-glasses-license.json (never commit it)

then replaces `public_key.txt` with the printed public key and rebuilds. Codes issued with the development
key stop working in that build. build.py prints a warning while the development key is in use.

Issue a code for a customer's device (the ID shown in the app's subscription row):

    node tools/license.js issue --device ABCD-EFGH-JK --plan yearly
    node tools/license.js issue --device ABCD-EFGH-JK --plan monthly --addons errors,hifz
