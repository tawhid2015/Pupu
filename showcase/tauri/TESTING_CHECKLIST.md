# Testing checklist

Run these after a rebuild. The app must stay on the approved reply voice and the typed path; this change adds local
Bangla listening, news detail levels, clipboard dictation, and grammar/style rewriting.

## Automated

```sh
cd showcase/tauri/sidecar && npm test
cd showcase/tauri && TAURI_BUNDLES=app ./build.sh
```

Install the rebuilt `/Applications/Roamies.app` and restart it.

## Hold-to-Speak

- [ ] **English is untouched.** With Listening set to English, hold the talk keys and say an English sentence. The
      transcript and reply behave as before; no Bangla model is downloaded for this path.
- [ ] **Bangla download.** With Listening on Auto or Bengali, open Settings → Voice. “Bangla listening” offers the
      one-time download (~818 MB on Apple Silicon, ~74 MB on Intel); press it and wait for “On this Mac”. No account
      or extra app is needed.
- [ ] **Standard Bangla.** Hold the keys and say one clear sentence. Words are not dropped or changed to English.
- [ ] **Conversational / mixed.** Say a conversational sentence with a few English words in it. The mixed words are
      kept in place instead of being replaced.
- [ ] **Long sentence.** Speak 25–35 words without stopping. The end is still recognised, and the first words still
      appear as quickly as before.
- [ ] **Empty take.** Tap the keys without speaking: the usual “I didn't hear anything…” reply appears; no empty
      request is sent.
- [ ] **Bengali region.** Repeat with Bengali (India) and Bengali (Bangladesh) selected.
- [ ] **Typing regression.** Type a normal question in the bubble and press Enter. Speed, reply flow and voice are
      unchanged.

## News detail

- [ ] **Saved default = Short.** Settings → News answers → Short. Ask for news: brief answer only, no source list,
      no source card and nothing pinned.
- [ ] **One-shot Medium.** Say “news medium”: headline, a few key facts and the publisher name. No links, card or
      pin. The next plain “news” returns to the saved Short setting.
- [ ] **One-shot Everything.** Say “news everything”: full account with publisher, headline and source links. A
      sources card is pinned automatically and survives a new drawing, a window change, Esc and Clear all. Its ×
      unpins it.
- [ ] **Saved default = Everything.** Plain “news” now gives the full answer and pinned sources. Saying “news short”
      once gives only a brief answer, and the saved setting is still Everything afterwards.
- [ ] **Bangla phrases.** “পুরো খবর”, “মাঝারি খবর” and “সংক্ষিপ্ত খবর” give the matching detail level, with Bengali
      prose. Publisher names and URLs may stay in their original script.
- [ ] **Real sources only.** Every displayed link came from the web tool results. If no link was returned, the reply
      says so instead of inventing one. Short and Medium never pin a card.
- [ ] **Setting buttons.** In Settings → News answers, Short / Medium / Everything each highlight immediately and
      become the saved default for the next plain “news”.

## Dictation to clipboard

- [ ] **Right Option default.** With Dictation on, a tap of the right Option key starts listening; the next tap sends
      the words. No talk keys, chat bubble, agent reply or spoken confirmation is involved.
- [ ] **Option alone.** Choose Left or Right Option (or record it). A single clean tap starts dictation; the same tap
      ends it. Starting a talk chord or typing ⌥M must not trigger dictation.
- [ ] **No automatic stop.** Start dictation, pause for 15–30 seconds without speaking, then speak and tap again.
      The whole recording is processed: silence, background noise or a long pause never ends the take.
- [ ] **Change the key.** Settings → Listening → Talking → Dictation key changes the hotkey (Left Option, Right
      Command, Left Command). The chosen key starts and ends dictation.
- [ ] **Left vs right Option.** Choose Left Option: only the left key starts dictation. Choose Right Option: only
      the right key does. The old flag-based detector could not tell them apart.
- [ ] **Detect / change key.** Press **Detect / change key**, then press any key or chord while the Settings panel
      is focused. The captured name appears; **Save this key** stores it, and it works in other apps too. Closing the
      panel before Save leaves the old key in place.
- [ ] **Restart keeps the key.** Quit and reopen Roamies. The saved key still starts and stops dictation.
- [ ] **Cancel and reset.** Esc or **Cancel** during detection leaves the old shortcut untouched.
      **Reset to Right Option** restores the default immediately.
- [ ] **Conflict warning.** Trying to record Escape, ⌘Q, ⌘Tab, ⌘Space or the talk/type chord shows a warning and
      does not save. A free combo such as Option+Space saves normally.
- [ ] **English dictation.** Dictation language = English. Speak a natural sentence; the exact words land on the
      clipboard and in the field you were in. Command-V works everywhere the app is allowed to paste.
- [ ] **Bangla dictation.** Dictation language = Bangla (the one-time Bangla model downloads in the background).
      Speak standard and mixed Bangla; the words are copied/pasted in Bengali script without an English rewrite or a
      wrong-word transcription. The language setting is independent of Listening and reply language.
- [ ] **Empty dictation.** Tap the dictation key without speaking: no clipboard change, no chat request and no
      “couldn't hear you” message — even on the first tap while the model is still downloading.
- [ ] **Paste blocked.** In a terminal or password app, the words still land on the clipboard and a short message says
      they were copied but not pasted. The same happens if Accessibility is off, with a pointer to the setting.

## Grammar and style

- [ ] **Accessibility already granted.** With Accessibility on for Roamies, select text in an app and say “fix the
      grammar”. It reads the selection and works immediately. System Settings never opens and no permission prompt
      appears — the old error-text check caused that loop.
- [ ] **Accessibility genuinely missing.** With Roamies turned off in Accessibility, the same request opens
      System Settings → Privacy & Security → Accessibility once, with a short explanation. Repeating the request
      in the same session does not nag again.
- [ ] **Fix grammar from selection.** Select text in a normal app, say “fix grammar”: only the corrected text is
      copied and pasted back. There is no chat turn and no spoken reading of the text.
- [ ] **Fix grammar from clipboard.** With no selection, copy some text and say “correct this”. The same flow works.
      If there is no selection or usable clipboard, Roamies asks for text instead of guessing.
- [ ] **Bangla and English.** Both languages are detected automatically. Meaning, context, mixed words and tone stay
      intact; no new information is added.
- [ ] **Style follow-up.** After a fix, when “Ask for writing style” is on, the question is spoken and typed. Answer
      by typing or by holding the talk keys and saying “Natural”, “Human”, “Friendly”, “Professional”, or “No,
      that's fine”. The chosen style is applied and pasted back; “No, that's fine” ends the task.
- [ ] **Direct style commands.** “Make it more natural”, “Make it sound human”, “Make it friendly”, “Make it more
      professional” and “Rewrite this naturally” work without fixing grammar first.
- [ ] **Follow-up off.** With “Ask for writing style” off, a fix just copies/pastes; direct style commands still work.
- [ ] **Cancellation.** Stop/Esc while the style question is open leaves the last corrected text on the clipboard and
      starts no chat request.

## Regressions to watch

- [ ] Reply voice, volume, loudness, tone, style and pace are exactly the approved Chatterbox / VoiceStudio output;
      the news level does not change the speaking voice.
- [ ] Playback, typing speed, wake word, area snap and the existing panel controls behave as before.
- [ ] An explicit English Listening locale never starts the local recognizer, even after a Bangla take.
