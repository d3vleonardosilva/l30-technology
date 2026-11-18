import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import generate_signing_key as keygen


class SigningKeyBackupTests(unittest.TestCase):
    def setUp(self):
        self.private = Ed25519PrivateKey.generate()
        self.private_der = self.private.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        public_der = self.private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        self.public_b64 = base64.b64encode(public_der).decode("ascii")
        self.key_id = "test-key-only"
        self.passphrase = "test-only-recovery-passphrase-123"

    def test_encrypted_backup_round_trip(self):
        encoded = keygen.encrypt_backup(
            self.private_der, self.key_id, self.public_b64, self.passphrase
        )
        document = json.loads(encoded)
        salt = base64.b64decode(document["salt"], validate=True)
        nonce = base64.b64decode(document["nonce"], validate=True)
        ciphertext = base64.b64decode(document["ciphertext"], validate=True)
        derived = keygen.derive_backup_key(self.passphrase, salt)
        aad = (
            keygen.AAD + b"|" + self.key_id.encode("utf-8") +
            b"|" + self.public_b64.encode("ascii")
        )
        restored = keygen.AESGCM(derived).decrypt(nonce, ciphertext, aad)
        self.assertEqual(restored, self.private_der)

    def test_backup_metadata_tampering_is_detected(self):
        encoded = keygen.encrypt_backup(
            self.private_der, self.key_id, self.public_b64, self.passphrase
        )
        document = json.loads(encoded)
        document["key_id"] = "tampered-key-id"
        salt = base64.b64decode(document["salt"], validate=True)
        nonce = base64.b64decode(document["nonce"], validate=True)
        ciphertext = base64.b64decode(document["ciphertext"], validate=True)
        derived = keygen.derive_backup_key(self.passphrase, salt)
        aad = (
            keygen.AAD + b"|" + document["key_id"].encode("utf-8") +
            b"|" + document["public_key_b64"].encode("ascii")
        )
        with self.assertRaises(InvalidTag):
            keygen.AESGCM(derived).decrypt(nonce, ciphertext, aad)

    def test_restore_writes_private_key_and_matching_public_key(self):
        encoded = keygen.encrypt_backup(
            self.private_der, self.key_id, self.public_b64, self.passphrase
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backup = root / "key-backup.enc"
            output = root / "restored"
            backup.write_bytes(encoded)
            with patch.object(keygen.getpass, "getpass", return_value=self.passphrase):
                keygen.restore_backup(backup, output)
            private_b64 = (output / "private_key_pkcs8.b64").read_text("ascii")
            self.assertEqual(base64.b64decode(private_b64), self.private_der)
            self.assertEqual((output / "public_key.b64").read_text("ascii"), self.public_b64)
            metadata = json.loads((output / "key_metadata.json").read_text("utf-8"))
            self.assertEqual(metadata["key_id"], self.key_id)


if __name__ == "__main__":
    unittest.main()
