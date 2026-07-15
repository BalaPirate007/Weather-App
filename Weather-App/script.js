// ============================================
// Weather Nexus — script.js
// Uses Open-Meteo (no API key required)
//   Geocoding:  https://geocoding-api.open-meteo.com/v1/search
//   Forecast:   https://api.open-meteo.com/v1/forecast
// ============================================

// ---- DOM references ----
const searchForm = document.getElementById("searchForm");
const cityInput = document.getElementById("cityInput");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const weatherEl = document.getElementById("weather");
const tempEl = document.getElementById("temp");
const cityEl = document.getElementById("city");
const conditionEl = document.getElementById("condition");
const cloudCoverEl = document.getElementById("cloudCover");
const windEl = document.getElementById("wind");
const humidityEl = document.getElementById("humidity");
const forecastListEl = document.getElementById("forecastList");

const LAST_CITY_KEY = "weatherNexus.lastCity";
const FETCH_TIMEOUT_MS = 8000;

// ---- WMO weather code -> { label, icon, theme } ----
// theme drives both the body class (used to show/hide the hero SVG's
// rays/rain/snow groups) and the small Font Awesome icon in each
// forecast row.
const WEATHER_CODES = {
  0: { label: "Clear sky", icon: "fa-sun", theme: "sunny" },
  1: { label: "Mainly clear", icon: "fa-sun", theme: "sunny" },
  2: { label: "Partly cloudy", icon: "fa-cloud-sun", theme: "cloudy" },
  3: { label: "Overcast", icon: "fa-cloud", theme: "cloudy" },
  45: { label: "Fog", icon: "fa-smog", theme: "cloudy" },
  48: { label: "Depositing rime fog", icon: "fa-smog", theme: "cloudy" },
  51: { label: "Light drizzle", icon: "fa-cloud-rain", theme: "rainy" },
  53: { label: "Moderate drizzle", icon: "fa-cloud-rain", theme: "rainy" },
  55: { label: "Dense drizzle", icon: "fa-cloud-rain", theme: "rainy" },
  61: { label: "Slight rain", icon: "fa-cloud-showers-heavy", theme: "rainy" },
  63: {
    label: "Moderate rain",
    icon: "fa-cloud-showers-heavy",
    theme: "rainy",
  },
  65: { label: "Heavy rain", icon: "fa-cloud-showers-heavy", theme: "rainy" },
  71: { label: "Slight snow", icon: "fa-snowflake", theme: "snow" },
  73: { label: "Moderate snow", icon: "fa-snowflake", theme: "snow" },
  75: { label: "Heavy snow", icon: "fa-snowflake", theme: "snow" },
  80: { label: "Rain showers", icon: "fa-cloud-showers-heavy", theme: "rainy" },
  81: { label: "Rain showers", icon: "fa-cloud-showers-heavy", theme: "rainy" },
  82: {
    label: "Violent rain showers",
    icon: "fa-cloud-showers-heavy",
    theme: "rainy",
  },
  95: { label: "Thunderstorm", icon: "fa-bolt", theme: "storm" },
  96: { label: "Thunderstorm, hail", icon: "fa-bolt", theme: "storm" },
  99: { label: "Thunderstorm, hail", icon: "fa-bolt", theme: "storm" },
};

const BODY_THEMES = ["sunny", "cloudy", "rainy", "snow", "storm"];

function codeToWeather(code) {
  return (
    WEATHER_CODES[code] || {
      label: "Unknown",
      icon: "fa-cloud-question",
      theme: null,
    }
  );
}

function applyBodyTheme(theme) {
  document.body.classList.remove(...BODY_THEMES);
  if (theme) document.body.classList.add(theme);
}

// ---- UI state helpers ----
function showLoading() {
  loadingEl.classList.add("active");
  errorEl.classList.remove("active");
  errorEl.textContent = "";
  weatherEl.classList.remove("active");
}

function hideLoading() {
  loadingEl.classList.remove("active");
}

function showError(message) {
  errorEl.innerHTML = `
    ${message}
    <button id="retryBtn" type="button">Retry</button>
  `;
  errorEl.classList.add("active");
  weatherEl.classList.remove("active");

  const retryBtn = document.getElementById("retryBtn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      const lastCity =
        cityInput.value.trim() || localStorage.getItem(LAST_CITY_KEY);
      if (lastCity) fetchWeatherForCity(lastCity);
    });
  }
}

function clearError() {
  errorEl.classList.remove("active");
  errorEl.textContent = "";
}

function renderWeather(cityName, currentData, dailyData) {
  const weather = codeToWeather(currentData.weather_code);

  tempEl.textContent = `${Math.round(currentData.temperature_2m)}°C`;
  cityEl.textContent = cityName;
  conditionEl.textContent = weather.label;
  cloudCoverEl.textContent = `${currentData.cloud_cover}%`;
  windEl.textContent = `${Math.round(currentData.wind_speed_10m)} km/h`;
  humidityEl.textContent = `${currentData.relative_humidity_2m}%`;

  applyBodyTheme(weather.theme);
  renderForecastList(dailyData);

  weatherEl.classList.add("active");
}

function renderForecastList(dailyData) {
  if (!dailyData || !dailyData.time) {
    forecastListEl.innerHTML = "";
    return;
  }

  const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });

  forecastListEl.innerHTML = dailyData.time
    .map((dateStr, i) => {
      const weather = codeToWeather(dailyData.weather_code[i]);
      const isToday = i === 0;
      const dayLabel = isToday
        ? "Today"
        : dayFormatter.format(new Date(dateStr));
      const max = Math.round(dailyData.temperature_2m_max[i]);
      const min = Math.round(dailyData.temperature_2m_min[i]);

      return `
      <div class="forecast-row${isToday ? " today" : ""}">
        <span class="forecast-day">${dayLabel}</span>
        <i class="fa-solid ${weather.icon}"></i>
        <span class="forecast-condition">${weather.label}</span>
        <span class="forecast-temps">${max}°<span class="low">${min}°</span></span>
      </div>
    `;
    })
    .join("");
}

// ---- Fetch with timeout (AbortController) ----
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Main flow: geocode city name -> coordinates -> current + 5-day forecast ----
async function fetchWeatherForCity(cityName) {
  showLoading();

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;
    const geoRes = await fetchWithTimeout(geoUrl, FETCH_TIMEOUT_MS);

    if (!geoRes.ok) throw new Error("NETWORK");
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      throw new Error("CITY_NOT_FOUND");
    }
    const userInput = cityName.trim().toLowerCase();

    const matchedCity = geoData.results.find(
      (city) => city.name.trim().toLowerCase() === userInput,
    );

    if (!matchedCity) {
      throw new Error("CITY_NOT_FOUND");
    }

    const { latitude, longitude, name, country } = matchedCity;

    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,cloud_cover` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&forecast_days=5&timezone=auto`;

    const weatherRes = await fetchWithTimeout(weatherUrl, FETCH_TIMEOUT_MS);

    if (!weatherRes.ok) throw new Error("NETWORK");
    const weatherData = await weatherRes.json();

    const displayName = country ? `${name}, ${country}` : name;
    renderWeather(displayName, weatherData.current, weatherData.daily);
    clearError();
    localStorage.setItem(LAST_CITY_KEY, cityName);
  } catch (err) {
    if (err.name === "AbortError") {
      showError("Request timed out. Check your connection.");
    } else if (err.message === "CITY_NOT_FOUND") {
      showError(`Couldn't find "${cityName}". Check the spelling.`);
    } else {
      showError("Something went wrong fetching the weather.");
    }
  } finally {
    hideLoading();
  }
}

// ---- Event listeners ----
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const city = cityInput.value.trim();
  if (!city) {
    showError("Please enter a city name.");
    return;
  }
  fetchWeatherForCity(city);
});

// ---- On load: restore last searched city ----
window.addEventListener("DOMContentLoaded", () => {
  const lastCity = localStorage.getItem(LAST_CITY_KEY);
  if (lastCity) {
    cityInput.value = lastCity;
    fetchWeatherForCity(lastCity);
  }
});
