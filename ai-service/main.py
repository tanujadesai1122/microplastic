import os
import uuid
import time
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from ultralytics import YOLO
from PIL import Image

# --------------------------------------------------
# APPLICATION CONFIGURATION
# --------------------------------------------------

app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "best.pt"
UPLOAD_FOLDER = BASE_DIR / "uploads"
RESULT_FOLDER = BASE_DIR / "results"

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
RESULT_FOLDER.mkdir(parents=True, exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB total

# --------------------------------------------------
# LOAD TRAINED YOLO MODEL
# --------------------------------------------------

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"Model file not found: {MODEL_PATH}\n"
        "Please place best.pt inside the ai_service folder."
    )

model = YOLO(str(MODEL_PATH))

print("YOLO model loaded successfully.")
print("AI service is starting...")

# --------------------------------------------------
# PARTICLE INFORMATION
# --------------------------------------------------

SOURCE_INFO = {
    "fiber": (
        "Possible textile or synthetic-fibre source",
        "Investigate possible textile-related sources and reduce "
        "the release of synthetic fibres."
    ),
    "film": (
        "Possible thin plastic packaging source",
        "Inspect packaging waste and improve plastic collection "
        "and disposal practices."
    ),
    "fragment": (
        "Possible broken plastic product source",
        "Check for damaged or discarded plastic products and "
        "prevent plastic waste from entering water."
    ),
    "pellet": (
        "Possible plastic resin pellet source",
        "Inspect possible industrial pellet handling and prevent "
        "pellet loss into the environment."
    ),
}

# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "success": True,
        "message": "Microplastic AI Service is running!"
    })


# --------------------------------------------------
# SERVE YOLO RESULT IMAGES TO REACT
# --------------------------------------------------

@app.route("/results/<path:filename>", methods=["GET"])
def serve_result_image(filename):
    return send_from_directory(str(RESULT_FOLDER), filename)


# --------------------------------------------------
# ANALYZE MULTIPLE IMAGES
# --------------------------------------------------

@app.route("/predict", methods=["POST"])
def predict():
    saved_uploads = []

    try:
        uploaded_files = request.files.getlist("images")

        if not uploaded_files or all(
            not file.filename for file in uploaded_files
        ):
            return jsonify({
                "success": False,
                "message": "Please upload at least one image."
            }), 400

        all_results = []
        total_particles = 0

        counts = {
            "fiber": 0,
            "film": 0,
            "fragment": 0,
            "pellet": 0
        }

        for uploaded_file in uploaded_files:
            if not uploaded_file.filename:
                continue

            # Save uploaded image with a unique filename
            original_name = Path(uploaded_file.filename).name
            extension = Path(original_name).suffix.lower()

            if extension not in {
                ".jpg", ".jpeg", ".png", ".bmp", ".webp"
            }:
                continue

            unique_id = uuid.uuid4().hex
            upload_name = f"{unique_id}_{original_name}"
            upload_path = UPLOAD_FOLDER / upload_name

            uploaded_file.save(str(upload_path))
            saved_uploads.append(upload_path)

            # Run YOLO prediction
            start_time = time.time()

            predictions = model.predict(
                source=str(upload_path),
                conf=0.25,
                imgsz=320,
                device="cpu",
                verbose=False
            )

            app.logger.info(
                "YOLO inference completed in %.2f seconds",
                time.time() - start_time
            )

            prediction = predictions[0]
            particles = []

            # Build a result image with bounding boxes
            plotted_image = prediction.plot()

            # Ultralytics returns a BGR image; convert to RGB
            # before saving with Pillow.
            from PIL import Image as PILImage
            from ultralytics.utils.plotting import colors
            import numpy as np

            rgb_image = plotted_image[:, :, ::-1]
            result_filename = f"result_{unique_id}.jpg"
            result_path = RESULT_FOLDER / result_filename

            PILImage.fromarray(
                np.ascontiguousarray(rgb_image)
            ).save(result_path, format="JPEG", quality=95)

            boxes = prediction.boxes

            if boxes is not None:
                image_height, image_width = prediction.orig_shape
                image_area = max(
                    image_height * image_width, 1
                )

                for box in boxes:
                    class_id = int(box.cls[0].item())
                    class_name = model.names.get(
                        class_id, str(class_id)
                    ).lower().strip()

                    confidence = round(
                        float(box.conf[0].item()) * 100, 2
                    )

                    # Bounding-box area as a proportion of image area.
                    # This is a relative visual estimate, not a physical
                    # particle measurement.
                    x1, y1, x2, y2 = [
                        float(value)
                        for value in box.xyxy[0].tolist()
                    ]

                    box_area = max(
                        x2 - x1, 0
                    ) * max(y2 - y1, 0)

                    area_percentage = (
                        box_area / image_area
                    ) * 100

                    if area_percentage < 1:
                        relative_size = "Small"
                    elif area_percentage < 5:
                        relative_size = "Medium"
                    else:
                        relative_size = "Large"

                    possible_source, recommendation = SOURCE_INFO.get(
                        class_name,
                        (
                            "Unknown possible source",
                            "Review the detection and consider laboratory "
                            "confirmation."
                        )
                    )

                    particles.append({
                        "shape": class_name,
                        "confidence": confidence,
                        "relative_size": relative_size,
                        "possible_source": possible_source,
                        "recommendation": recommendation
                    })

                    if class_name in counts:
                        counts[class_name] += 1

            particle_count = len(particles)
            total_particles += particle_count

            all_results.append({
                "filename": original_name,
                "result_image": result_filename,
                "particle_count": particle_count,
                "particles": particles
            })

        if not all_results:
            return jsonify({
                "success": False,
                "message": (
                    "No supported image files were uploaded. "
                    "Use JPG, JPEG, PNG, BMP, or WEBP."
                )
            }), 400

        return jsonify({
            "success": True,
            "message": "Images analyzed successfully.",
            "total_images": len(all_results),
            "total_particles": total_particles,
            "counts": counts,
            "results": all_results
        })

    except Exception as error:
        app.logger.exception("Image analysis failed.")
        return jsonify({
            "success": False,
            "message": "An error occurred during image analysis.",
            "error": str(error)
        }), 500

    finally:
        # Remove uploaded originals after processing.
        for file_path in saved_uploads:
            try:
                if file_path.exists():
                    os.remove(file_path)
            except OSError:
                app.logger.warning(
                    "Could not remove temporary upload: %s",
                    file_path
                )


# --------------------------------------------------
# START SERVICE
# --------------------------------------------------

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=8000,
        debug=False
    )