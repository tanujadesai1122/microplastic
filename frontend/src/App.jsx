import { useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import "./App.css";

const COLORS = ["#0891b2", "#8b5cf6", "#f59e0b", "#10b981"];

const API_URL = "https://microplastic-1-88mt.onrender.com";
const AI_URL = "https://microplastic-833w.onrender.com";

function ScreeningStatus({ totalParticles }) {
  const count = Number(totalParticles) || 0;
  const hasDetections = count > 0;

  return (
    <div className={`screening-status ${hasDetections ? "has-detections" : "no-detections"}`}>
      <span className="screening-label">
        PRELIMINARY VISUAL SCREENING
      </span>

      <h3>
        {hasDetections
          ? "Potential Microplastics Detected"
          : "No Matching Particles Detected"}
      </h3>

      <p>
        {hasDetections
          ? `The model detected ${count} particle(s) matching its trained visual classes. These particles may include microplastics, but visual detection alone cannot confirm their chemical composition.`
          : "The model did not detect matching particles at the current confidence threshold. This does not prove that the water sample is free of microplastics."}
      </p>

      {hasDetections && (
        <div className="screening-warning">
          <strong>Important:</strong> Other materials can have similar
          shapes and appearances. Laboratory techniques such as FTIR
          or Raman spectroscopy can help confirm whether detected
          particles are plastic.
        </div>
      )}
    </div>
  );
}

function ParticleCard({ particle, index }) {
  const shape = String(particle.shape || "Unknown");
  const shapeClass = shape.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const hasConfidence =
    particle.confidence !== null &&
    particle.confidence !== undefined &&
    particle.confidence !== "";

  const confidence = hasConfidence
    ? Math.min(100, Math.max(0, Number(particle.confidence) || 0))
    : 0;

  return (
    <article className="particle-card">
      <div className="particle-card-header">
        <div>
          <span className="particle-number">
            PARTICLE {String(index + 1).padStart(2, "0")}
          </span>
          <h4>{shape.charAt(0).toUpperCase() + shape.slice(1)}</h4>
        </div>

        <span className={`shape-badge shape-${shapeClass}`}>
          {shape}
        </span>
      </div>

      <div className="confidence-section">
        <div className="confidence-heading">
          <span>Model confidence</span>
          <strong>
            {hasConfidence ? `${particle.confidence}%` : "N/A"}
          </strong>
        </div>

        {hasConfidence && (
          <div
            className="confidence-track"
            role="progressbar"
            aria-label="Model prediction confidence"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={confidence}
          >
            <div
              className="confidence-fill"
              style={{ width: `${confidence}%` }}
            />
          </div>
        )}

        <p className="confidence-caption">
          Confidence in the visual prediction, not proof of plastic composition.
        </p>
      </div>

      <div className="particle-info">
        <div className="particle-info-row">
          <span className="info-icon" aria-hidden="true">◈</span>
          <div>
            <span className="info-label">Relative size</span>
            <p>{particle.relative_size ?? "Not available"}</p>
          </div>
        </div>

        <div className="particle-info-row">
          <span className="info-icon" aria-hidden="true">⌕</span>
          <div>
            <span className="info-label">Possible source</span>
            <p>{particle.possible_source ?? "Not available"}</p>
          </div>
        </div>
      </div>

      <div className="recommendation-box">
        <span className="recommendation-title">
          <span aria-hidden="true">💡</span> Recommended action
        </span>
        <p>
          {particle.recommendation ??
            "Further investigation is recommended."}
        </p>
      </div>
    </article>
  );
}

function ParticleResults({ imageResult, index }) {
  const particles = imageResult.particles || [];
  const particleCount = imageResult.particle_count ?? particles.length;

  return (
    <article
      className="result-card image-result-card"
      key={`${imageResult.filename}-${index}`}
    >
      <div className="image-result-heading">
        <div>
          <span className="result-kicker">IMAGE {index + 1}</span>
          <h3>{imageResult.filename || `Image ${index + 1}`}</h3>
        </div>

        <div className="image-count-badge">
          {particleCount} detected
        </div>
      </div>

      {imageResult.result_image && (
        <img
          className="result-image"
          src={`${AI_URL}/results/${imageResult.result_image}`}
          alt={`Visual detections for ${imageResult.filename || "uploaded image"}`}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}

      {particles.length > 0 ? (
        <div className="particle-list">
          {particles.map((particle, particleIndex) => (
            <ParticleCard
              key={particleIndex}
              particle={particle}
              index={particleIndex}
            />
          ))}
        </div>
      ) : (
        <div className="empty-result">
          <span aria-hidden="true">🔎</span>
          <p>
            No matching particles were detected in this image at the
            current confidence threshold.
          </p>
        </div>
      )}
    </article>
  );
}

function App() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [message, setMessage] = useState("");

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState(null);

  const handleImageChange = (event) => {
    setImages(Array.from(event.target.files || []));
    setResults(null);
    setMessage("");
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryMessage("");

    try {
      const response = await fetch(`${API_URL}/api/history`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load history.");
      }

      setHistory(data.history || []);
    } catch (error) {
      console.error(error);
      setHistoryMessage(
        error.message || "Could not connect to the history service."
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleHistory = async () => {
    const nextValue = !showHistory;
    setShowHistory(nextValue);
    setSelectedHistory(null);

    if (nextValue) {
      await fetchHistory();
    }
  };

  const handleAnalyze = async () => {
    if (images.length === 0) {
      setMessage("Please select at least one image.");
      return;
    }

    const formData = new FormData();
    images.forEach((image) => {
      formData.append("images", image);
    });

    try {
      setLoading(true);
      setMessage("");
      setResults(null);

      const response = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Analysis failed.");
      }

      setResults(data);

      if (showHistory) {
        await fetchHistory();
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Could not connect to the backend.");
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = (report = results) => {
    if (!report) return;

    const rows = [
      [
        "Image",
        "Particle Number",
        "Shape",
        "Model Confidence (%)",
        "Relative Size",
        "Possible Source",
        "Recommendation",
        "Interpretation",
      ],
    ];

    (report.results || []).forEach((imageResult) => {
      const particles = imageResult.particles || [];

      if (particles.length === 0) {
        rows.push([
          imageResult.filename || "",
          "",
          "No matching particles detected",
          "",
          "",
          "",
          "",
          "No matching visual detections; microplastics are not ruled out.",
        ]);
      }

      particles.forEach((particle, index) => {
        rows.push([
          imageResult.filename || "",
          index + 1,
          particle.shape ?? "",
          particle.confidence ?? "",
          particle.relative_size ?? "",
          particle.possible_source ?? "",
          particle.recommendation ?? "",
          "Potential particle; plastic composition not chemically confirmed.",
        ]);
      });
    });

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "microplastic_analysis_report.csv";

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  const counts = results?.counts || {};

  const chartData = [
    { name: "Fiber", count: Number(counts.fiber || 0) },
    { name: "Film", count: Number(counts.film || 0) },
    { name: "Fragment", count: Number(counts.fragment || 0) },
    { name: "Pellet", count: Number(counts.pellet || 0) },
  ];

  const totalParticles = Number(results?.total_particles || 0);

  const renderSavedResults = (report) => {
    const savedCounts = report.counts || {};

    const savedChartData = [
      { name: "Fiber", count: Number(savedCounts.fiber || 0) },
      { name: "Film", count: Number(savedCounts.film || 0) },
      { name: "Fragment", count: Number(savedCounts.fragment || 0) },
      { name: "Pellet", count: Number(savedCounts.pellet || 0) },
    ];

    const savedResults =
      typeof report.results === "string"
        ? (() => {
            try {
              return JSON.parse(report.results);
            } catch {
              return [];
            }
          })()
        : report.results || [];

    return (
      <div className="saved-analysis-details">
        <button
          className="back-button"
          onClick={() => setSelectedHistory(null)}
        >
          ← Back to History
        </button>

        <h3 className="saved-title">Saved Analysis #{report.id}</h3>

        <p className="saved-date">
          <strong>Date:</strong>{" "}
          {new Date(report.analyzed_at).toLocaleString()}
        </p>

        <div className="summary-grid saved-summary-grid">
          <div className="summary-card">
            <h3>Images Analyzed</h3>
            <strong>{report.total_images}</strong>
          </div>
          <div className="summary-card">
            <h3>Total Detections</h3>
            <strong>{report.total_particles}</strong>
          </div>
        </div>

        <ScreeningStatus totalParticles={report.total_particles} />

        <div className="summary-grid">
          {savedChartData.map((item) => (
            <div className="summary-card" key={item.name}>
              <h3>{item.name}</h3>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>

        <div className="chart-card saved-chart-card">
          <h3>Saved Particle Distribution</h3>

          {Number(report.total_particles) > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={savedChartData.filter((item) => item.count > 0)}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={85}
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                >
                  {savedChartData
                    .filter((item) => item.count > 0)
                    .map((item) => (
                      <Cell
                        key={item.name}
                        fill={
                          COLORS[
                            savedChartData.findIndex(
                              (entry) => entry.name === item.name
                            )
                          ]
                        }
                      />
                    ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p>No matching particles were detected in this saved analysis.</p>
          )}
        </div>

        {savedResults.map((imageResult, index) => (
          <ParticleResults
            key={`${imageResult.filename}-${index}`}
            imageResult={imageResult}
            index={index}
          />
        ))}

        <button
          className="download-button"
          onClick={() => downloadReport({ ...report, results: savedResults })}
        >
          Download This Analysis as CSV
        </button>
      </div>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <span className="header-tag">AI • DEEP LEARNING • WATER QUALITY</span>
          <h1>Microplastic Detection System</h1>
          <p>
            AI-powered visual screening of suspected microplastic particles
            in microscopic water-sample images.
          </p>
        </div>
      </header>

      <main className="container">
        <section className="card upload-card">
          <div className="section-heading">
            <span className="section-icon">🔬</span>
            <div>
              <h2>Analyze Water-Sample Images</h2>
              <p className="description">
                Upload one or more microscopic images to screen for
                particles matching your trained YOLO model.
              </p>
            </div>
          </div>

          <label className="upload-box">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageChange}
            />
            <div className="upload-content">
              <div className="upload-icon">📷</div>
              <h3>Choose Microscopic Images</h3>
              <p>Click here to select or replace images</p>
              <span className="upload-hint">
                Multiple image selection supported
              </span>
            </div>
          </label>

          {images.length > 0 && (
            <div className="selected-images">
              <div className="selected-heading">
                <h3>Selected Images</h3>
                <span>{images.length} selected</span>
              </div>

              <div className="image-list">
                {images.map((image, index) => (
                  <div
                    className="image-item"
                    key={`${image.name}-${index}`}
                  >
                    <img
                      src={URL.createObjectURL(image)}
                      alt={`Selected image ${index + 1}`}
                    />
                    <p>{image.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            className="analyze-button"
            disabled={images.length === 0 || loading}
            onClick={handleAnalyze}
          >
            {loading ? "⏳ Analyzing Images..." : "🔍 Analyze Images"}
          </button>

          {loading && (
            <p className="loading-note">
              Please wait while the AI model processes your images.
            </p>
          )}

          {message && (
            <div className="error-message" role="alert">
              {message}
            </div>
          )}
        </section>

        <section className="card history-section">
          <div className="report-heading">
            <div className="section-heading history-heading">
              <span className="section-icon">🕘</span>
              <div>
                <h2>Analysis History</h2>
                <p className="description">
                  Revisit previously saved analysis records.
                </p>
              </div>
            </div>

            <button
              className="download-button"
              onClick={handleToggleHistory}
            >
              {showHistory ? "Hide History" : "View Analysis History"}
            </button>
          </div>

          {showHistory && (
            <div className="history-content">
              <button
                className="secondary-button"
                onClick={fetchHistory}
                disabled={historyLoading}
              >
                {historyLoading ? "Refreshing..." : "↻ Refresh History"}
              </button>

              {historyMessage && (
                <div className="error-message">{historyMessage}</div>
              )}

              {historyLoading ? (
                <p className="empty-history">Loading saved analyses...</p>
              ) : selectedHistory ? (
                renderSavedResults(selectedHistory)
              ) : history.length === 0 && !historyMessage ? (
                <div className="empty-history">
                  <span>📂</span>
                  <h3>No Saved Analyses Yet</h3>
                  <p>Analyze an image to create your first history record.</p>
                </div>
              ) : (
                <div className="history-list">
                  {history.map((record) => (
                    <article className="history-record" key={record.id}>
                      <div className="history-record-icon">📊</div>
                      <div className="history-record-content">
                        <h3>Analysis #{record.id}</h3>
                        <p>
                          {new Date(record.analyzed_at).toLocaleString()}
                        </p>
                        <div className="history-record-stats">
                          <span>{record.total_images} image(s)</span>
                          <span>{record.total_particles} detection(s)</span>
                        </div>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={() => setSelectedHistory(record)}
                      >
                        View Details
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {results && (
          <section className="results-section">
            <div className="report-heading results-heading">
              <div>
                <p className="report-kicker">ANALYSIS DASHBOARD</p>
                <h2>Screening Results</h2>
                <p className="description">
                  Review detected particle shapes and model predictions.
                </p>
              </div>

              <button
                className="download-button"
                onClick={() => downloadReport(results)}
              >
                ↓ Download CSV Report
              </button>
            </div>

            <ScreeningStatus totalParticles={totalParticles} />

            <div className="summary-grid">
              <div className="summary-card">
                <span className="summary-icon">🖼️</span>
                <h3>Images Analyzed</h3>
                <strong>
                  {results.total_images ?? results.results?.length ?? 0}
                </strong>
              </div>

              <div className="summary-card">
                <span className="summary-icon">🔎</span>
                <h3>Total Detections</h3>
                <strong>{totalParticles}</strong>
                <p>Visual model detections</p>
              </div>

              {chartData.map((item, index) => (
                <div className="summary-card" key={item.name}>
                  <span className="summary-icon">
                    {["〰️", "▱", "◈", "●"][index]}
                  </span>
                  <h3>{item.name}</h3>
                  <strong>{item.count}</strong>
                  <p>
                    {totalParticles > 0
                      ? `${((item.count / totalParticles) * 100).toFixed(1)}% of detections`
                      : "0% of detections"}
                  </p>
                </div>
              ))}
            </div>

            <div className="charts-grid">
              <div className="chart-card">
                <h3>Particle Shape Distribution</h3>
                <p>Proportion of detections by trained class</p>

                {totalParticles > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={chartData.filter((item) => item.count > 0)}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        paddingAngle={3}
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                      >
                        {chartData
                          .filter((item) => item.count > 0)
                          .map((item) => (
                            <Cell
                              key={item.name}
                              fill={
                                COLORS[
                                  chartData.findIndex(
                                    (entry) => entry.name === item.name
                                  )
                                ]
                              }
                            />
                          ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-chart">
                    No matching particles were detected to chart.
                  </div>
                )}
              </div>

              <div className="chart-card">
                <h3>Detections by Shape</h3>
                <p>Compare model detection counts across classes</p>

                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 20, right: 15, left: 0, bottom: 10 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                    />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      name="Detections"
                      fill="#0891b2"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="report-note">
              <strong>Scientific interpretation:</strong> The displayed
              shapes and confidence scores represent visual model
              predictions. They do not chemically verify that a particle
              is plastic. Possible sources are suggestions based on shape,
              not confirmed origins. Laboratory analysis may be required.
            </div>

            {(results.results || []).map((imageResult, index) => (
              <ParticleResults
                key={`${imageResult.filename}-${index}`}
                imageResult={imageResult}
                index={index}
              />
            ))}
          </section>
        )}

        <section className="features">
          <div className="feature-card">
            <span className="feature-icon">🔬</span>
            <h3>Particle Screening</h3>
            <p>
              Use a trained YOLO model to detect particles matching
              selected visual classes.
            </p>
          </div>

          <div className="feature-card">
            <span className="feature-icon">📊</span>
            <h3>Visual Analytics</h3>
            <p>
              Explore particle counts and shape distribution through charts.
            </p>
          </div>

          <div className="feature-card">
            <span className="feature-icon">📄</span>
            <h3>Exportable Reports</h3>
            <p>
              Download particle-level results for further analysis.
            </p>
          </div>

          <div className="feature-card">
            <span className="feature-icon">🕘</span>
            <h3>Analysis History</h3>
            <p>
              Revisit saved analysis counts and particle details.
            </p>
          </div>

          <div className="feature-card">
            <span className="feature-icon">💡</span>
            <h3>Follow-up Guidance</h3>
            <p>
              Review possible sources and suggested next steps.
            </p>
          </div>
        </section>
      </main>

      <footer>
        <p className="footer-title">AI/ML Microplastic Detection System</p>
        <p>
          Preliminary visual screening only. Plastic composition requires
          appropriate laboratory confirmation.
        </p>
      </footer>
    </div>
  );
}

export default App;