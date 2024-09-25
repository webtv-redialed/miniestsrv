const CryptoJS = require("crypto-js");
const endianness = require("endianness");
var crypto = require("crypto");

/**
 * Javascript implementation of WTVP Security
 *
 * Special Thanks to eMac (Eric MacDonald)
 * For the encryption/decryption information and process
 *
 * By: zefie
 */

class WTVSec {
    // Initial Shared Key, in Base64 Format
    // You can change this but it doesn't mean much for security. Just make sure its static. 8 bytes base64 encoded.
    // If you intend to link multiple minisrv's together, they must all share the same Initial Shared Key.

    initial_shared_key_b64 = "CC5rWmRUE0o=";

    initial_shared_key = null;
    current_shared_key = null;
    challenge_key = null;
    challenge_signed_key = null;
    challenge_raw = null;
    challenge_response = null;
    ticket_b64 = null;
    incarnation = 0;
    session_key1 = null;
    session_key2 = null;
    hRC4_Key1 = null;
    hRC4_Key2 = null;
    RC4Session = new Array();
    minisrv_config = [];
    update_ticket = false;
    ticket_store = {};

    /**
     *
     * Initialize the WTVSec class.
     *
     * @param {Number} wtv_incarnation Sets the wtv-incarnation for this instance
     * @param {Boolean} minisrv_config.config.debug_flags.debug Enable debugging
     *
     */
    constructor(minisrv_config, wtv_incarnation = 1) {
        this.minisrv_config = minisrv_config;
        this.initial_shared_key = CryptoJS.enc.Base64.parse(
            this.initial_shared_key_b64
        );

        if (this.initial_shared_key.sigBytes === 8) {
            this.incarnation = wtv_incarnation;
            this.current_shared_key = this.initial_shared_key;
        } else {
            throw "Invalid initial key length";
        }
    }

    /**
     * Set the wtv-incarnation for this instance
     *
     * @param {Number} wtv_incarnation
     */
    set_incarnation(wtv_incarnation) {
        if (this.incarnation != wtv_incarnation) {
            this.incarnation = wtv_incarnation;
            this.SecureOn();
        }
    }

    /**
     * Increments the wtv-incaration for this instance by 1
     */
    increment_incarnation() {
        this.set_incarnation(parseInt(this.incarnation) + 1);
    }

    /**
     * Clones a WordArray to allow modification without referencing its original
     * @param {CryptoJS.lib.WordArray} wa
     *
     * @returns {CryptoJS.lib.WordArray}
     */
    DuplicateWordArray(wa) {
        return CryptoJS.lib.WordArray.create(this.wordArrayToBuffer(wa));
    }

    /**
     * Prepares the wtv-ticket for this instance
     */
    PrepareTicket() {
        // store last challenge response in ticket
        if (this.minisrv_config.config.debug_flags.debug)
            console.log(
                " * Preparing a new ticket with ticket_store:",
                this.ticket_store
            );
        var ticket_data_raw = this.challenge_raw;
        try {
            var ticket_data =
                ticket_data_raw.toString(CryptoJS.enc.Hex) +
                CryptoJS.enc.Utf8.parse(JSON.stringify(this.ticket_store)).toString(
                    CryptoJS.enc.Hex
                );

            ticket_data_raw = CryptoJS.enc.Hex.parse(ticket_data);
            var ticket_data_enc = CryptoJS.DES.encrypt(
                ticket_data_raw,
                this.initial_shared_key,
                {
                    mode: CryptoJS.mode.ECB,
                    padding: CryptoJS.pad.Pkcs7,
                }
            );
            // create a copy of WordArray since concat modifies the original
            var challenge_signed_key = this.DuplicateWordArray(
                this.challenge_signed_key
            );
            this.ticket_b64 = challenge_signed_key
                .concat(ticket_data_enc.ciphertext)
                .toString(CryptoJS.enc.Base64);
        } catch (e) {
            console.log("Error encrypting ticket: " + e.toString());
            return null;
        }
        return this.ticket_b64;
    }

    tryDecodeJSON(json_string) {
        var out;
        try {
            out = JSON.parse(json_string);
        } catch (e) {
            console.log(e);
            out = {};
        }
        return out;
    }

    /**
     * Decodes a wtv-ticket to set up this instance
     *
     * @param {Base64} ticket_b64
     */
    DecodeTicket(ticket_b64) {
        var ticket_hex = CryptoJS.enc.Base64.parse(ticket_b64).toString(
            CryptoJS.enc.Hex
        );
        var challenge_key = CryptoJS.enc.Hex.parse(ticket_hex.substring(0, 16));
        var challenge_enc = CryptoJS.enc.Hex.parse(ticket_hex.substring(16));

        var ticket_dec = CryptoJS.DES.decrypt(
            {
                ciphertext: challenge_enc,
            },
            this.initial_shared_key,
            {
                mode: CryptoJS.mode.ECB,
                padding: CryptoJS.pad.Pkcs7,
            }
        );
        var data_offset = 216; // (108 * 2);
        var challenge_code = ticket_dec.toString().substring(0, data_offset);
        var challenge_code_b64 = CryptoJS.enc.Hex.parse(challenge_code).toString(
            CryptoJS.enc.Base64
        );
        if (ticket_dec.sigBytes * 2 >= challenge_code.length) {
            var ticket_data_dec = CryptoJS.enc.Hex.parse(
                ticket_dec.toString().substring(data_offset)
            ).toString(CryptoJS.enc.Utf8);
            this.ticket_store = this.tryDecodeJSON(ticket_data_dec);
        } else {
            this.ticket_store = {};
        }

        this.ProcessChallenge(challenge_code_b64, challenge_key);
        if (this.minisrv_config.config.debug_flags.debug)
            console.log(
                " * Decoded session from wtv-ticket with ticket_store:",
                this.ticket_store
            );
    }

    getTicketData(key = null) {
        if (typeof this.ticket_store === "session_store") return null;
        else if (key === null) return this.ticket_store;
        else return null;
    }

    setTicketData(key, value) {
        if (key === null) throw "WTVSec.ssetTicketDataet(): invalid key provided";
        if (typeof this.ticket_store === "undefined") this.ticket_store = {};
        this.ticket_store[key] = value;
        if (this.ticket_b64) this.PrepareTicket();
        this.update_ticket = true;
    }

    deleteTicketData(key) {
        if (key === null) throw "WTVSec.deleteTicketData(): invalid key provided";
        if (typeof this.ticket_store === "undefined") {
            this.ticket_store = {};
            return;
        }
        delete this.ticket_store[key];
        if (this.ticket_b64) this.PrepareTicket();
        this.update_ticket = true;
    }

    /**
     * Processes a wtv-challenge to get the expected response
     * @param {Base64} wtv_challenge
     * @param {any} key
     *
     * @returns {CryptoJS.lib.WordArray} wtv-challenge-response (or blank if failed)
     */
    ProcessChallenge(wtv_challenge, key = this.current_shared_key) {
        var challenge_raw = CryptoJS.enc.Base64.parse(wtv_challenge);

        if (challenge_raw.sigBytes > 8) {
            var challenge_raw_hex = challenge_raw.toString(CryptoJS.enc.Hex);
            var challenge_id_hex = challenge_raw_hex.substring(0, 8 * 2);
            var challenge_enc_hex = challenge_raw_hex.substring(8 * 2);
            var challenge_enc = CryptoJS.enc.Hex.parse(challenge_enc_hex);

            var challenge_decrypted = CryptoJS.DES.decrypt(
                {
                    ciphertext: challenge_enc,
                },
                key,
                {
                    mode: CryptoJS.mode.ECB,
                    padding: CryptoJS.pad.NoPadding,
                }
            );

            var challenge_dec_hex = challenge_decrypted.toString(CryptoJS.enc.Hex);
            var challenge_md5_challenge = CryptoJS.MD5(
                CryptoJS.enc.Hex.parse(challenge_dec_hex.substring(0, 80 * 2))
            );
            var test = challenge_dec_hex.substring(80 * 2, 96 * 2);
            var test2 = challenge_md5_challenge.toString(CryptoJS.enc.Hex);
            if (test == test2) {
                this.current_shared_key = CryptoJS.enc.Hex.parse(
                    challenge_dec_hex.substring(72 * 2, 80 * 2)
                );
                var challenge_echo = CryptoJS.enc.Hex.parse(
                    challenge_dec_hex.substr(0, 40 * 2)
                );

                // RC4 encryption keys.Stored in the wtv-ticket on the server side.
                this.session_key1 = CryptoJS.enc.Hex.parse(
                    challenge_dec_hex.substring(40 * 2, 56 * 2)
                );
                this.session_key2 = CryptoJS.enc.Hex.parse(
                    challenge_dec_hex.substring(56 * 2, 72 * 2)
                );

                var echo_encrypted = CryptoJS.DES.encrypt(
                    CryptoJS.MD5(challenge_echo)
                        .concat(challenge_echo)
                        .concat(CryptoJS.enc.Utf8.parse("\x08".repeat(8))),
                    this.current_shared_key,
                    {
                        mode: CryptoJS.mode.ECB,
                        padding: CryptoJS.pad.NoPadding,
                    }
                );

                // Last bytes is just extra padding
                this.challenge_raw = challenge_raw;
                this.challenge_key = this.current_shared_key;
                var challenge_response = CryptoJS.enc.Hex.parse(
                    challenge_raw_hex.substr(0, 8 * 2)
                ).concat(echo_encrypted.ciphertext);
                return challenge_response;
            } else {
                return "";
            }
        } else {
            throw "Invalid challenge length";
        }
    }

    /**
     * Generates a wtv-challenge for this instance
     *
     * @returns {Base64} wtv-challenge
     */
    IssueChallenge() {
        /*
         *  bytes 0-8: Random id? Just echoed in the response
         *  bytes 8 - XX: DES encrypted block.Encrypted with the initial key or subsequent keys from the challenge.
         *	bytes 8 - 48: hidden random data we echo back in the response
         *	bytes 48 - 64: session key 1 used in RC4 encryption triggered by SECURE ON
         *	bytes 64 - 80: session key 2 used in RC4 encryption triggered by SECURE ON
         *	bytes 80 - 88: new key for future challenges
         *	bytes 88 - 104: MD5 of 8 - 88
         *	bytes 104 - 112: padding.not important
         */

        var challenge_id = CryptoJS.lib.WordArray.random(8);

        var echo_me = CryptoJS.lib.WordArray.random(40);
        this.session_key1 = CryptoJS.lib.WordArray.random(16);
        this.session_key2 = CryptoJS.lib.WordArray.random(16);
        var new_shared_key = CryptoJS.lib.WordArray.random(8);

        var session_key1 = this.DuplicateWordArray(this.session_key1);
        var session_key2 = this.DuplicateWordArray(this.session_key2);

        var challenge_puzzle = echo_me.concat(
            session_key1.concat(session_key2.concat(new_shared_key))
        );
        var challenge_secret = challenge_puzzle.concat(
            CryptoJS.MD5(challenge_puzzle).concat(
                CryptoJS.enc.Hex.parse("\x08".repeat(8))
            )
        );

        // Shhhh!!
        var challenge_secreted = CryptoJS.DES.encrypt(
            challenge_secret,
            this.current_shared_key,
            {
                mode: CryptoJS.mode.ECB,
                padding: CryptoJS.pad.NoPadding,
            }
        );

        var challenge = challenge_id.concat(challenge_secreted.ciphertext);
        var challenge_b64 = challenge.toString(CryptoJS.enc.Base64);
        // get the expected response for when client sends it
        this.challenge_signed_key = this.current_shared_key;
        this.challenge_response = this.ProcessChallenge(challenge_b64);
        return challenge_b64;
    }

    /**
     * convert a CryptoJS.lib.WordArray to a Javascript Buffer
     * @param {CryptoJS.lib.WordArray} wordArray
     *
     * #returns {Buffer} JS Buffer object
     */
    wordArrayToBuffer(wordArray) {
        if (wordArray)
            return new Buffer.from(wordArray.toString(CryptoJS.enc.Hex), "hex");
        else return null;
    }

    /**
     * Starts an encryption session
     * @param {Number} rc4session Session Type (0 = enc k1, 1 = dec k1, 3 = enc k2, 4 = dec k2, default: all)
     *
     */
    SecureOn(rc4session = null) {
        if (this.minisrv_config.config.debug_flags.debug)
            console.log(
                " # Generating RC4 sessions with wtv-incarnation: " + this.incarnation
            );

        var buf = new Uint8Array([
            0xff & this.incarnation,
            0xff & (this.incarnation >> 8),
            0xff & (this.incarnation >> 16),
            0xff & (this.incarnation >> 24),
        ]);
        endianness(buf, 4);
        this.hRC4_Key1 = CryptoJS.MD5(
            this.DuplicateWordArray(this.session_key1).concat(
                CryptoJS.lib.WordArray.create(buf).concat(
                    this.DuplicateWordArray(this.session_key1)
                )
            )
        );
        this.hRC4_Key2 = CryptoJS.MD5(
            this.DuplicateWordArray(this.session_key2).concat(
                CryptoJS.lib.WordArray.create(buf).concat(
                    this.DuplicateWordArray(this.session_key2)
                )
            )
        );
        var key1 = this.wordArrayToBuffer(this.hRC4_Key1);
        var key2 = this.wordArrayToBuffer(this.hRC4_Key2);
        switch (rc4session) {
            case 0:
                this.RC4Session[0] = crypto.createCipheriv("rc4", key1, "");
                break;
            case 1:
                this.RC4Session[1] = crypto.createDecipheriv("rc4", key1, "");
                break;
            case 2:
                this.RC4Session[2] = crypto.createCipheriv("rc4", key2, "");
                break;
            case 3:
                this.RC4Session[3] = crypto.createDecipheriv("rc4", key2, "");
                break;
            default:
                this.RC4Session[0] = crypto.createCipheriv("rc4", key1, "");
                this.RC4Session[1] = crypto.createDecipheriv("rc4", key1, "");
                this.RC4Session[2] = crypto.createCipheriv("rc4", key2, "");
                this.RC4Session[3] = crypto.createDecipheriv("rc4", key2, "");
                break;
        }
    }

    /**
     * RC4 Encrypt data
     * @param {Number} keynum Which key to use (0 = k1, 1 = k2)
     * @param {CryptoJS.lib.WordArray|ArrayBuffer|Buffer} data Data to encrypt
     *
     * @returns {ArrayBuffer} Encrypted data
     */
    Encrypt(keynum, data) {
        var session_id;
        switch (keynum) {
            case 0:
                session_id = 0;
                break;
            case 1:
                session_id = 2;
                break;
            default:
                throw "Invalid key option (0 or 1 only)";
                break;
        }
        if (!this.RC4Session[session_id]) {
            this.SecureOn(session_id);
        }
        if (data.words) {
            data = this.wordArrayToBuffer(data);
        } else if (data.constructor === ArrayBuffer) {
            data = new Buffer.from(data);
        }
        return this.RC4Session[session_id].update(data);
    }

    /**
     * RC4 Decrypt data
     * @param {Number} keynum Which key to use (0 = k1, 1 = k2)
     * @param {CryptoJS.lib.WordArray|ArrayBuffer|Buffer} data Data to decrypt
     *
     * @returns {ArrayBuffer} Decrypted data
     */
    Decrypt(keynum, data) {
        var session_id;
        switch (keynum) {
            case 0:
                session_id = 1;
                break;
            case 1:
                session_id = 3;
                break;
            default:
                throw "Invalid key option (0 or 1 only)";
                break;
        }
        if (!this.RC4Session[session_id]) {
            this.SecureOn(session_id);
        }
        if (data.words) {
            data = this.wordArrayToBuffer(data);
        } else if (data.constructor === ArrayBuffer) {
            data = new Buffer.from(data);
        }
        return this.RC4Session[session_id].update(data);
    }
}

module.exports = WTVSec;
