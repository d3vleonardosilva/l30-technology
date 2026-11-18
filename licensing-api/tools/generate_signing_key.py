#!/usr/bin/env python3
"""Generate or restore a Floating Camera Ed25519 signing key.

Private material is written only below LOCALAPPDATA (Windows) or ~/.local/share
(Linux/macOS). An AES-GCM encrypted recovery copy is created using a passphrase
that is never saved by this script. Never upload the plaintext .b64 file.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

AAD = b"L30 Floating Camera Ed25519 key backup v1"
KDF_ITERATIONS = 600_000
DEFAULT_KEY_ID = "l30-floating-camera-ed25519-2026-11"


def default_dir() -> Path:
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "L30Technology" / "FloatingCamera" / "keys"
    return Path.home() / ".local" / "share" / "l30-technology" / "floating-camera" / "keys"


def protect_windows_acl(path: Path) -> None:
    if os.name != "nt":
        return
    try:
        identity = subprocess.check_output(["whoami"], text=True, stderr=subprocess.DEVNULL).strip()
        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r", identity + ":(OI)(CI)F"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        raise RuntimeError("Não foi possível restringir as permissões da pasta de chaves com icacls.")


def write_new_file(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def ask_passphrase() -> str:
    first = getpass.getpass("Senha forte para o backup criptografado (mínimo 18 caracteres): ")
    second = getpass.getpass("Repita a senha: ")
    if len(first) < 18 or first != second:
        raise ValueError("A senha deve ter no mínimo 18 caracteres e as duas entradas devem coincidir.")
    return first


def derive_backup_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=KDF_ITERATIONS)
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt_backup(private_der: bytes, key_id: str, public_b64: str, passphrase: str) -> bytes:
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)
    key = derive_backup_key(passphrase, salt)
    authenticated_metadata = AAD + b"|" + key_id.encode("utf-8") + b"|" + public_b64.encode("ascii")
    ciphertext = AESGCM(key).encrypt(nonce, private_der, authenticated_metadata)
    document = {
        "format": "L30-FC-ED25519-BACKUP-V1",
        "key_id": key_id,
        "algorithm": "Ed25519",
        "kdf": "PBKDF2-HMAC-SHA256",
        "iterations": KDF_ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "public_key_b64": public_b64,
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }
    return json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8")


def restore_backup(backup_path: Path, output_dir: Path) -> None:
    document = json.loads(backup_path.read_text(encoding="utf-8"))
    if document.get("format") != "L30-FC-ED25519-BACKUP-V1":
        raise ValueError("Formato de backup não reconhecido.")
    if output_dir.exists() and (output_dir / "private_key_pkcs8.b64").exists():
        raise FileExistsError("Já existe uma chave privada no destino. Não será sobrescrita.")
    output_dir.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        output_dir.chmod(0o700)
    protect_windows_acl(output_dir)

    passphrase = getpass.getpass("Senha do backup: ")
    salt = base64.b64decode(document["salt"], validate=True)
    nonce = base64.b64decode(document["nonce"], validate=True)
    ciphertext = base64.b64decode(document["ciphertext"], validate=True)
    key = derive_backup_key(passphrase, salt)
    authenticated_metadata = AAD + b"|" + document["key_id"].encode("utf-8") + b"|" + document["public_key_b64"].encode("ascii")
    private_der = AESGCM(key).decrypt(nonce, ciphertext, authenticated_metadata)

    private_key = serialization.load_der_private_key(private_der, password=None)
    if not isinstance(private_key, Ed25519PrivateKey):
        raise ValueError("O backup não contém uma chave Ed25519.")
    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    actual_public = base64.b64encode(public_der).decode("ascii")
    if actual_public != document.get("public_key_b64"):
        raise ValueError("A chave restaurada não corresponde à chave pública do backup.")

    write_new_file(output_dir / "private_key_pkcs8.b64", base64.b64encode(private_der))
    write_new_file(output_dir / "public_key.b64", actual_public.encode("ascii"))
    metadata = {
        "key_id": document["key_id"],
        "algorithm": "Ed25519",
        "restored_at": datetime.now(timezone.utc).isoformat(),
        "public_key_b64": actual_public,
        "private_key_file": "private_key_pkcs8.b64",
    }
    write_new_file(
        output_dir / "key_metadata.json",
        json.dumps(metadata, indent=2).encode("utf-8"),
    )
    print("Chave restaurada localmente.")
    print("Key ID:", document["key_id"])
    print("Chave pública Base64:", actual_public)
    print("Arquivo privado local:", output_dir / "private_key_pkcs8.b64")
    print("Não envie nem publique o arquivo privado.")


def generate(output_dir: Path, key_id: str) -> None:
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(
            "A pasta de destino não está vazia. Escolha outra pasta; nenhuma chave foi sobrescrita."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        output_dir.chmod(0o700)
    protect_windows_acl(output_dir)

    private_key = Ed25519PrivateKey.generate()
    private_der = private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    public_b64 = base64.b64encode(public_der).decode("ascii")
    # Self-test: private/public pair must be mathematically consistent.
    test_message = b"L30 Floating Camera key-pair self-test v1"
    private_key.public_key().verify(private_key.sign(test_message), test_message)

    passphrase = ask_passphrase()
    backup = encrypt_backup(private_der, key_id, public_b64, passphrase)
    write_new_file(output_dir / "private_key_pkcs8.b64", base64.b64encode(private_der))
    write_new_file(output_dir / "public_key.b64", public_b64.encode("ascii"))
    write_new_file(output_dir / "private_key_backup.enc", backup)

    metadata = {
        "key_id": key_id,
        "algorithm": "Ed25519",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "public_key_b64": public_b64,
        "private_key_file": "private_key_pkcs8.b64",
        "encrypted_backup_file": "private_key_backup.enc",
        "kdf": "PBKDF2-HMAC-SHA256",
        "kdf_iterations": KDF_ITERATIONS,
    }
    write_new_file(
        output_dir / "key_metadata.json",
        json.dumps(metadata, indent=2).encode("utf-8"),
    )

    print("Par Ed25519 gerado e verificado.")
    print("Key ID:", key_id)
    print("CHAVE PÚBLICA Base64 (pode ser adicionada ao aplicativo):")
    print(public_b64)
    print("Arquivo privado local:", output_dir / "private_key_pkcs8.b64")
    print("Backup criptografado:", output_dir / "private_key_backup.enc")
    print("Guarde o backup criptografado em dois locais independentes.")
    print("Guarde a senha do backup separadamente, em um gerenciador de senhas.")
    print("Nunca envie o arquivo privado ou a senha ao chat, GitHub ou Drive sem criptografia.")
    print("Após cadastrar o segredo no Cloudflare, remova a cópia privada em texto Base64.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=default_dir())
    parser.add_argument("--key-id", default=DEFAULT_KEY_ID)
    parser.add_argument("--restore", type=Path, help="Restaurar um backup criptografado .enc")
    args = parser.parse_args()

    try:
        if args.restore:
            restore_backup(args.restore, args.output_dir)
        else:
            generate(args.output_dir, args.key_id)
        return 0
    except Exception as exc:
        print("Falha:", str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
