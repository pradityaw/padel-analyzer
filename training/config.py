"""Training configuration and constants."""

from pathlib import Path

# Paths
ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
MODEL_DIR = ROOT_DIR / "checkpoints"
EXPORT_DIR = ROOT_DIR.parent / "client" / "public" / "models"

# Shot types (must match shared/types.ts SHOT_TYPES)
SHOT_TYPES = [
    "bandeja",
    "vibora",
    "smash",
    "volley",
    "drive",
    "lob",
    "bajada",
    "other",
]
NUM_CLASSES = len(SHOT_TYPES)

# MediaPipe landmarks
NUM_LANDMARKS = 33
LANDMARK_DIMS = 4  # x, y, z, visibility
FEATURES_PER_FRAME = NUM_LANDMARKS * LANDMARK_DIMS  # 132
# With velocity features: 132 position + 132 velocity = 264
TOTAL_FEATURES = FEATURES_PER_FRAME * 2

# Preprocessing
MAX_FRAMES = 64  # pad/truncate to this length (~4.3s at 15fps)
SAMPLE_FPS = 15

# Model architecture
CONV_CHANNELS = [128, 128, 64]
ATTENTION_HEADS = 4
HIDDEN_DIM = 32
DROPOUT = 0.2
CLASSIFIER_DROPOUT = 0.3

# Training
LEARNING_RATE = 1e-3
BATCH_SIZE = 16
MAX_EPOCHS = 100
PATIENCE = 10
NUM_FOLDS = 5
NOISE_STD = 0.005
JITTER_FRAMES = 3
FRAME_DROPOUT_RATE = 0.1
