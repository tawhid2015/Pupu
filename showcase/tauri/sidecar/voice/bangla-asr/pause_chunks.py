"""Pause-aware chunks preserving all samples; energy selection is a heuristic."""
import numpy as np


def plan_chunks(audio, sr=16000, max_seconds=26.0, min_seconds=12.0, min_pause_seconds=0.18):
    audio = np.asarray(audio)
    if audio.ndim != 1 or not np.isfinite(audio).all():
        raise ValueError('Expected finite mono audio')
    if sr <= 0 or not 0 < min_seconds < max_seconds < 30:
        raise ValueError('Invalid sample rate or chunk limits')
    n = len(audio)
    if n == 0:
        return []
    limit, minimum = round(max_seconds*sr), round(min_seconds*sr)
    if n <= limit:
        return [dict(start_sample=0,end_sample=n,boundary='end')]
    frame = max(1,round(0.01*sr))
    padded = np.pad(audio,(0,(-n)%frame))
    energy = np.sqrt(np.mean(padded.reshape(-1,frame).astype(np.float64)**2,axis=1))
    threshold = max(1e-5,float(np.quantile(energy,0.95))*0.08)
    quiet = energy < threshold
    transitions = np.diff(np.r_[False,quiet,False].astype(np.int8))
    starts,ends = np.flatnonzero(transitions==1),np.flatnonzero(transitions==-1)
    pauses = [(int((a+b)*frame//2),(b-a)*frame/sr) for a,b in zip(starts,ends)
              if (b-a)*frame/sr >= min_pause_seconds]
    chunks,start = [],0
    while n-start > limit:
        eligible = [(point,duration) for point,duration in pauses if start+minimum <= point <= start+limit]
        if eligible:
            end,pause_duration = eligible[-1]
            boundary = 'pause'
        else:
            end,pause_duration = start+limit,0.0
            boundary = 'forced-no-pause'
        chunks.append(dict(start_sample=start,end_sample=end,boundary=boundary,
                           pause_duration_s=pause_duration,rms_threshold=threshold))
        start = end
    chunks.append(dict(start_sample=start,end_sample=n,boundary='end'))
    return chunks
