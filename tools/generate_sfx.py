import wave
import math
import random
import struct
import os

def generate_clunk(filepath):
    # Audio parameters
    sample_rate = 44100
    duration = 0.15  # Short thud
    frequency = 80.0 # Low frequency
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    with wave.open(filepath, 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        
        n_samples = int(sample_rate * duration)
        
        for i in range(n_samples):
            t = i / sample_rate
            
            # Envelope: Fast attack, exponential decay
            envelope = math.exp(-t * 25) 
            
            # Waveform: Sine wave mixed with some noise for "texture"
            signal = math.sin(2 * math.pi * frequency * t)
            
            # Add some noise for the "thud" character
            noise = (random.random() - 0.5) * 0.5
            
            # Pitch drop for impact effect
            frequency *= 0.9995
            
            # Combine
            value = (signal + noise) * envelope
            
            # Scale to 16-bit integer
            sample = int(value * 32767.0)
            sample = max(-32768, min(32767, sample))
            
            wav_file.writeframes(struct.pack('<h', sample))
            
    print(f"Generated: {filepath}")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_path = os.path.join(base_dir, 'src', 'assets', 'sounds', 'clunk.wav')
    generate_clunk(target_path)
