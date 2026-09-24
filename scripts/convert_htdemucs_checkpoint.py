"""Converts an official Demucs "hybrid transformer" checkpoint (.th) into the safetensors package layout audio.cpp's htdemucs
loader reads (manifest.json + <dir>/config.json + <dir>/model.safetensors), so models the engine does not ship as GGUF, such as
htdemucs_6s (drums, bass, other, vocals, guitar, piano), can be used.

    python scripts/convert_htdemucs_checkpoint.py <checkpoint.th> <output_dir> --name htdemucs_6s

Needs torch + safetensors (for example the YuE2 python environment). The checkpoint is read with a stub unpickler, so the demucs
package itself does not have to be installed. The engine's model spec looks for the weights in a folder called 955717e8, so that
folder name is kept; the real signature is recorded inside config.json.
"""
import argparse
import json
import os
import pickle
import zipfile


class _Stub:
    """Stands in for any class the checkpoint pickle refers to (demucs classes, argparse.Namespace, ...)."""
    def __init__(self, *args, **kwargs):
        pass

    def __setstate__(self, state):
        self.__dict__['state'] = state


class _StubUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module.startswith('torch') or module in ('collections', 'builtins', '_codecs', 'fractions', 'numpy', 'numpy.core.multiarray', 'numpy._core.multiarray'):
            return super().find_class(module, name)
        return _Stub


class _StubPickleModule:
    Unpickler = _StubUnpickler
    load = staticmethod(pickle.load)
    __name__ = 'pickle'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint')
    parser.add_argument('output_dir')
    parser.add_argument('--name', default='htdemucs_converted')
    parser.add_argument('--folder', default='955717e8', help='weights folder name the engine model spec expects')
    args = parser.parse_args()

    import torch
    from safetensors.torch import save_file

    package = torch.load(args.checkpoint, map_location='cpu', weights_only=False, pickle_module=_StubPickleModule)
    # the segment length is stored as fractions.Fraction (39/5); the engine config uses the plain number (7.8)
    kwargs = {key: (float(value) if type(value).__name__ == 'Fraction' else value) for key, value in package['kwargs'].items()}
    state = package['state']
    signature = os.path.basename(args.checkpoint).split('-')[0]
    sources = list(kwargs['sources'])

    config = {
        'model_type': 'demucs', 'class_name': 'HTDemucs', 'signature': signature, 'checkpoint_file': os.path.basename(args.checkpoint),
        'args': list(package.get('args', [])), 'kwargs': kwargs,
        'sources': sources, 'samplerate': kwargs['samplerate'], 'audio_channels': kwargs['audio_channels'], 'segment': kwargs['segment'],
    }
    manifest = {
        'model_type': 'demucs_single_alias', 'name': args.name, 'alias_of': args.folder,
        'model': {'signature': signature, 'checkpoint_file': os.path.basename(args.checkpoint), 'output_dir': args.folder, 'tensor_count': len(state)},
    }
    target = os.path.join(args.output_dir, args.folder)
    os.makedirs(target, exist_ok=True)
    tensors = {name: value.detach().contiguous().to(torch.float32) for name, value in state.items()}
    # htdemucs_6s has no channel bottleneck (bottom_channels = 0) but the engine always builds the up/down projections. An identity
    # 1x1 convolution of the transformer width (channels * growth ** (depth - 1)) in their place computes exactly the same result.
    if not kwargs.get('bottom_channels'):
        width = int(kwargs['channels'] * kwargs['growth'] ** (kwargs['depth'] - 1))
        kwargs['bottom_channels'] = width
        config['kwargs']['bottom_channels'] = width
        for name in ('channel_upsampler', 'channel_upsampler_t', 'channel_downsampler', 'channel_downsampler_t'):
            tensors[name + '.weight'] = torch.eye(width, dtype=torch.float32).unsqueeze(-1).contiguous()
            tensors[name + '.bias'] = torch.zeros(width, dtype=torch.float32)
        manifest['model']['tensor_count'] = len(tensors)
    save_file(tensors, os.path.join(target, 'model.safetensors'))
    with open(os.path.join(target, 'config.json'), 'w', encoding='utf8') as handle:
        json.dump(config, handle, indent=2)
    with open(os.path.join(args.output_dir, 'manifest.json'), 'w', encoding='utf8') as handle:
        json.dump(manifest, handle, indent=2)
    print(f'{len(tensors)} tensors, sources={sources}, signature={signature} -> {args.output_dir}')


if __name__ == '__main__':
    main()
