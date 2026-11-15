"""Windows user-bound encrypted local credential; never stored in source."""
import ctypes
import json
import os
from pathlib import Path
import sys

KEY_PATH=Path(__file__).resolve().parent / '.data' / 'provider-key.dpapi'


def _crypt(data, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('Use DEEPSEEK_API_KEY environment variable on this platform.')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
    buffer=ctypes.create_string_buffer(data)
    source=Blob(len(data),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)))
    output=Blob()
    function=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    function.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    function.restype=wintypes.BOOL
    if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(output)):
        raise RuntimeError('Windows credential encryption failed.')
    try:
        return ctypes.string_at(output.data,output.size)
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes=[ctypes.c_void_p]
        ctypes.windll.kernel32.LocalFree(ctypes.cast(output.data,ctypes.c_void_p))


def get_review_key():
    key=os.environ.get('DEEPSEEK_API_KEY','')
    if key:
        return key
    if KEY_PATH.exists() and os.name=='nt':
        try:
            return _crypt(KEY_PATH.read_bytes(),True).decode('utf-8')
        except Exception:
            return ''
    return ''


if __name__=='__main__':
    if '--set' in sys.argv:
        key=json.load(sys.stdin).get('key','')
        if not isinstance(key,str) or not key.startswith('sk-') or not 20<len(key)<512:
            raise ValueError('Invalid credential format')
        KEY_PATH.parent.mkdir(parents=True,exist_ok=True)
        KEY_PATH.write_bytes(_crypt(key.encode('utf-8')))
        print('Local backend credential encrypted for the current Windows user.')
    else:
        print(json.dumps({'configured':bool(get_review_key())}))
