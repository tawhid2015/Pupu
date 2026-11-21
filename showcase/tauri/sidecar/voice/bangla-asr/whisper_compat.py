"""Project-local workaround for MLX Audio 0.5.3 HF no-speech token lookup.

The checked HF Whisper vocabularies use <|nocaptions|>. Looking up the absent
<|nospeech|> returns unk_token_id == eos_token_id, suppressing termination.
No site-packages files are modified. Fail closed if neither spelling exists.
"""
from types import MethodType
from mlx_audio.stt.models.whisper.whisper import HFTokenizerWrapper
from mlx_audio.stt.models.whisper.decoding import get_suppress_tokens


class CompatibleTokenizer(HFTokenizerWrapper):
    @property
    def no_speech(self):
        vocab = self.hf_tokenizer.get_vocab()
        for token in ('<|nocaptions|>', '<|nospeech|>'):
            if token in vocab:
                token_id = vocab[token]
                if token_id == self.eot:
                    raise ValueError('No-speech token must differ from end-of-transcript')
                return token_id
        raise ValueError('No known no-speech token in Whisper vocabulary')


def apply_tokenizer_fix(model):
    original = model.get_tokenizer(language='bn')
    before = original.no_speech

    def get_tokenizer(self, language=None, task='transcribe'):
        return CompatibleTokenizer(self._processor.tokenizer,
                                   multilingual=self.is_multilingual,
                                   num_languages=self.num_languages,
                                   language=language, task=task)
    model.get_tokenizer = MethodType(get_tokenizer, model)
    after = model.get_tokenizer(language='bn')
    assert after.no_speech != after.eot
    assert after.eot not in get_suppress_tokens(after)
    return dict(original_no_speech_id=before, corrected_no_speech_id=after.no_speech,
                eot_id=after.eot, description='Resolve no-speech by vocabulary membership, never unknown-token fallback.')
