"""Downloads the official Demucs htdemucs_6s checkpoint (drums, bass, other, vocals, guitar, piano) and converts it into
models/audio-cpp/htdemucs-6s/, the folder the "STEM 분리 (6갈래)" menu uses.

    <python with torch + safetensors> scripts/setup_htdemucs_6s.py            (for example the YuE2 python environment)

The checkpoint comes from Meta's Demucs release server; the last 8 hex digits of its file name are the start of its SHA-256,
which is checked after the download. The conversion itself is scripts/convert_htdemucs_checkpoint.py.
Requires the audio.cpp build of this project (it contains the htdemucs head-size fix, see docs/patches/).
"""
import hashlib
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th'
TARGET = os.path.join(ROOT, 'models', 'audio-cpp', 'htdemucs-6s')
CACHE = os.path.join(ROOT, 'models', 'audio-cpp', 'htdemucs-6s-download')


def main():
    os.makedirs(CACHE, exist_ok=True)
    checkpoint = os.path.join(CACHE, os.path.basename(URL))
    if not os.path.exists(checkpoint):
        print('downloading', URL)
        urllib.request.urlretrieve(URL, checkpoint + '.partial')
        os.replace(checkpoint + '.partial', checkpoint)
    digest = hashlib.sha256(open(checkpoint, 'rb').read()).hexdigest()
    expected = os.path.basename(URL).split('-')[1].split('.')[0]
    if not digest.startswith(expected):
        os.remove(checkpoint)
        sys.exit(f'checksum mismatch: {digest[:8]} != {expected}; the file was removed, run again')
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'scripts', 'convert_htdemucs_checkpoint.py'), checkpoint, TARGET, '--name', 'htdemucs_6s'])
    print('done ->', TARGET)


if __name__ == '__main__':
    main()
