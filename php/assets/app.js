/**
 * Discogs Photo Collector — vanilla-JS port of components/RecordCapture.tsx
 * and components/ResultCard.tsx.
 *
 * No build step: the target is Apache + PHP shared hosting with no Node
 * toolchain, so React/JSX/TypeScript are replaced with direct DOM building.
 * Nodes are constructed rather than interpolated into innerHTML because every
 * string here (titles, notes, tracklists) is third-party data from Discogs.
 */
(function () {
  "use strict";

  // Strip any credentials from the base: with Basic auth people bookmark
  // https://user:pass@host/discogs/, and fetch() refuses a URL containing them.
  var API_BASE = (function () {
    var base = new URL(".", window.location.href);
    base.username = "";
    base.password = "";
    return base.href;
  })();

  var MAX_DIMENSION = 1600;
  var JPEG_QUALITY = 0.82;
  var BARCODE_TIMEOUT_MS = 4000;

  var EMPTY_REVIEW_FIELDS = { artist: "", title: "", label: "", catalogNumber: "" };

  var state = {
    imageUrl: null,
    stage: "idle", // idle | scanning-barcode | identifying | review | searching | results | no-match
    identified: null,
    results: [],
    addStatus: {},
    error: null,
    expandedId: null,
    releaseDetails: {},
    detailsLoading: {},
    detailsError: {},
    ownedMap: {},
    priceMap: {},
    reviewFields: Object.assign({}, EMPTY_REVIEW_FIELDS)
  };

  // ---------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "style") Object.assign(node.style, value);
        else if (key.indexOf("on") === 0) node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value === true ? "" : value);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ---------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------

  function parseJsonResponse(res) {
    return res.text().then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(
          res.ok
            ? "Server returned an unexpected response"
            : "Request failed (" + res.status + "): " + (text.slice(0, 200) || res.statusText)
        );
      }
    });
  }

  function fetchSearchResults(params) {
    return fetch(API_BASE + "api/search.php?" + params.toString())
      .then(parseJsonResponse)
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        return data.results || [];
      });
  }

  // ---------------------------------------------------------------------
  // Image handling
  // ---------------------------------------------------------------------

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Phone camera photos can be several MB; shrink + re-encode as JPEG so the
  // base64 payload stays well under the server's post_max_size.
  function shrinkImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var width = img.width;
        var height = img.height;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported on this browser"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.onerror = function () {
        reject(new Error("Could not load the photo for resizing"));
      };
      img.src = dataUrl;
    });
  }

  function scanBarcode(dataUrl) {
    if (!window.ZXing || !window.ZXing.BrowserMultiFormatReader) {
      return Promise.resolve(null);
    }
    try {
      var reader = new window.ZXing.BrowserMultiFormatReader();
      var timeout = new Promise(function (resolve) {
        setTimeout(function () {
          resolve(null);
        }, BARCODE_TIMEOUT_MS);
      });
      return Promise.race([reader.decodeFromImageUrl(dataUrl), timeout])
        .then(function (result) {
          return result ? result.getText() : null;
        })
        .catch(function () {
          return null;
        });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // ---------------------------------------------------------------------
  // Enrichment (non-critical — failures stay silent, as in the original)
  // ---------------------------------------------------------------------

  function checkOwnership(resultsList) {
    if (!resultsList.length) return;
    var ids = resultsList
      .map(function (r) {
        return r.id;
      })
      .join(",");
    fetch(API_BASE + "api/collection-status.php?releaseIds=" + encodeURIComponent(ids))
      .then(parseJsonResponse)
      .then(function (data) {
        if (data && data.owned) {
          Object.assign(state.ownedMap, data.owned);
          renderResults();
        }
      })
      .catch(function () {});
  }

  function checkPrices(resultsList) {
    if (!resultsList.length) return;
    var ids = resultsList
      .map(function (r) {
        return r.id;
      })
      .join(",");
    fetch(API_BASE + "api/price-status.php?releaseIds=" + encodeURIComponent(ids))
      .then(parseJsonResponse)
      .then(function (data) {
        if (data && data.prices) {
          Object.assign(state.priceMap, data.prices);
          renderResults();
        }
      })
      .catch(function () {});
  }

  // ---------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------

  function handleFile(file) {
    state.error = null;
    state.identified = null;
    state.results = [];
    state.addStatus = {};
    state.expandedId = null;
    state.releaseDetails = {};
    state.detailsLoading = {};
    state.detailsError = {};
    state.ownedMap = {};
    state.priceMap = {};
    state.reviewFields = Object.assign({}, EMPTY_REVIEW_FIELDS);

    fileToDataUrl(file)
      .then(shrinkImage)
      .then(function (dataUrl) {
        state.imageUrl = dataUrl;
        state.stage = "scanning-barcode";
        render();

        return scanBarcode(dataUrl).then(function (barcode) {
          if (!barcode) return null;
          state.stage = "searching";
          render();
          return fetchSearchResults(new URLSearchParams({ barcode: barcode })).then(function (results) {
            if (!results.length) return null;
            state.results = results;
            state.stage = "results";
            render();
            checkOwnership(results);
            checkPrices(results);
            return "done";
          });
        });
      })
      .then(function (outcome) {
        if (outcome === "done") return null;

        state.stage = "identifying";
        render();

        var base64 = state.imageUrl.split(",")[1];
        return fetch(API_BASE + "api/identify.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" })
        })
          .then(parseJsonResponse)
          .then(function (identified) {
            if (identified.error) throw new Error(identified.error);
            state.identified = identified;
            state.reviewFields = {
              artist: identified.artist || "",
              title: identified.title || "",
              label: identified.label || "",
              catalogNumber: identified.catalogNumber || ""
            };
            state.stage = "review";
            render();
            return null;
          });
      })
      .catch(function (err) {
        state.error = err && err.message ? err.message : "Something went wrong";
        state.stage = "idle";
        render();
      });
  }

  function runSearch() {
    state.error = null;
    var params = new URLSearchParams();
    if (state.reviewFields.artist.trim()) params.set("artist", state.reviewFields.artist.trim());
    if (state.reviewFields.title.trim()) params.set("release_title", state.reviewFields.title.trim());
    if (state.reviewFields.label.trim()) params.set("label", state.reviewFields.label.trim());
    if (state.reviewFields.catalogNumber.trim()) params.set("catno", state.reviewFields.catalogNumber.trim());

    if (Array.from(params.keys()).length === 0) {
      state.error = "Enter at least one field to search with.";
      render();
      return;
    }

    state.stage = "searching";
    render();

    fetchSearchResults(params)
      .then(function (results) {
        state.results = results;
        state.stage = results.length > 0 ? "results" : "no-match";
        render();
        checkOwnership(results);
        checkPrices(results);
      })
      .catch(function (err) {
        state.error = err && err.message ? err.message : "Something went wrong";
        state.stage = "review";
        render();
      });
  }

  function handleAdd(releaseId) {
    state.addStatus[releaseId] = "adding";
    renderResults();

    fetch(API_BASE + "api/add.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: releaseId })
    })
      .then(parseJsonResponse)
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        state.addStatus[releaseId] = "added";
        state.ownedMap[releaseId] = (state.ownedMap[releaseId] || 0) + 1;
        render();
      })
      .catch(function (err) {
        state.addStatus[releaseId] = "error";
        state.error = err && err.message ? err.message : "Could not add to collection";
        render();
      });
  }

  function toggleExpand(releaseId) {
    if (state.expandedId === releaseId) {
      state.expandedId = null;
      renderResults();
      return;
    }
    state.expandedId = releaseId;

    if (state.releaseDetails[releaseId] || state.detailsLoading[releaseId]) {
      renderResults();
      return;
    }

    state.detailsLoading[releaseId] = true;
    delete state.detailsError[releaseId];
    renderResults();

    fetch(API_BASE + "api/release.php?id=" + encodeURIComponent(releaseId))
      .then(parseJsonResponse)
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        state.releaseDetails[releaseId] = data;
      })
      .catch(function (err) {
        state.detailsError[releaseId] = err && err.message ? err.message : "Could not load details";
      })
      .then(function () {
        state.detailsLoading[releaseId] = false;
        renderResults();
      });
  }

  function reset() {
    state.imageUrl = null;
    state.stage = "idle";
    state.identified = null;
    state.results = [];
    state.addStatus = {};
    state.error = null;
    state.expandedId = null;
    state.releaseDetails = {};
    state.detailsLoading = {};
    state.detailsError = {};
    state.ownedMap = {};
    state.priceMap = {};
    state.reviewFields = Object.assign({}, EMPTY_REVIEW_FIELDS);
    render();
  }

  // ---------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------

  function formatPrice(currency, value) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency }).format(value);
    } catch (e) {
      return currency + " " + Number(value).toFixed(2);
    }
  }

  function getYoutubeId(uri) {
    try {
      var url = new URL(uri);
      if (url.hostname.indexOf("youtu.be") !== -1) return url.pathname.slice(1) || null;
      return url.searchParams.get("v");
    } catch (e) {
      return null;
    }
  }

  function joinDefined(parts, separator) {
    return parts
      .filter(function (p) {
        return p !== null && p !== undefined && p !== "";
      })
      .join(separator);
  }

  // ---------------------------------------------------------------------
  // Lightbox
  // ---------------------------------------------------------------------

  function openLightbox(uri) {
    var img = el("img", { src: uri, alt: "" });
    img.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    var box = el("div", { class: "lightbox" }, [
      el("button", { class: "lightbox-close", "aria-label": "Close", text: "×" }),
      img
    ]);
    box.addEventListener("click", function () {
      document.body.removeChild(box);
    });
    document.body.appendChild(box);
  }

  // ---------------------------------------------------------------------
  // Result card (port of ResultCard.tsx)
  // ---------------------------------------------------------------------

  function buildResultCard(result) {
    var ownedCount = state.ownedMap[result.id] || 0;
    var owned = ownedCount > 0;
    var price = state.priceMap[result.id] || null;
    var status = state.addStatus[result.id] || "idle";
    var expanded = state.expandedId === result.id;

    var info = el("div", { class: "result-info" }, [
      el("div", { class: "result-title", text: result.title || "" }),
      el("div", {
        class: "result-meta",
        text: joinDefined(
          [
            result.year,
            result.format ? result.format.join(", ") : null,
            result.label ? result.label.join(", ") : null,
            result.catno
          ],
          " · "
        )
      }),
      price
        ? el("div", {
            class: "result-meta",
            text:
              "Median " +
              formatPrice(price.currency, price.median) +
              " · Max " +
              formatPrice(price.currency, price.high)
          })
        : null,
      owned
        ? el("div", {
            class: "owned-badge",
            text: "✓ In your collection" + (ownedCount > 1 ? " (" + ownedCount + ")" : "")
          })
        : null,
      el("div", { class: "result-expand-hint", text: expanded ? "Hide details ▲" : "View details ▼" })
    ]);

    var discogsLink = el("a", {
      href: "https://www.discogs.com/release/" + result.id,
      target: "_blank",
      rel: "noopener noreferrer",
      class: "button secondary",
      text: "Open in Discogs"
    });
    discogsLink.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    var addButton = el("button", {
      text: status === "added" ? "Added ✓" : status === "adding" ? "Adding…" : "Add",
      disabled: status === "adding" || status === "added"
    });
    addButton.addEventListener("click", function (e) {
      e.stopPropagation();
      handleAdd(result.id);
    });

    var card = el("div", { class: "result-card", role: "button", tabindex: "0" }, [
      el("img", {
        class: "result-thumb",
        src: result.thumb || result.cover_image || "",
        alt: "",
        loading: "lazy"
      }),
      info,
      el("div", { class: "result-actions" }, [discogsLink, addButton])
    ]);
    card.addEventListener("click", function () {
      toggleExpand(result.id);
    });

    var wrapper = el("div", { class: "result-card-wrapper" + (owned ? " owned" : "") }, [card]);

    if (expanded) {
      wrapper.appendChild(buildResultDetail(result, ownedCount, price));
    }

    return wrapper;
  }

  function buildResultDetail(result, ownedCount, price) {
    var details = state.releaseDetails[result.id] || null;
    var loading = state.detailsLoading[result.id] || false;
    var errorMessage = state.detailsError[result.id] || null;
    var owned = ownedCount > 0;

    var detail = el("div", { class: "result-detail" });

    if (loading) detail.appendChild(el("p", { class: "status", text: "Loading details…" }));
    if (errorMessage) detail.appendChild(el("p", { class: "error", text: errorMessage }));
    if (owned) {
      detail.appendChild(
        el("p", {
          class: "owned-banner",
          text:
            "You already have this release in your collection" +
            (ownedCount > 1 ? " — " + ownedCount + " copies" : "") +
            "."
        })
      );
    }

    if (!details) return detail;

    if (details.images && details.images.length) {
      var gallery = el("div", { class: "result-detail-gallery" });
      details.images.forEach(function (image) {
        var thumb = el("img", { src: image.uri, alt: "", loading: "lazy" });
        thumb.addEventListener("click", function () {
          openLightbox(image.uri);
        });
        gallery.appendChild(thumb);
      });
      detail.appendChild(gallery);
    }

    var meta = el("div", { class: "result-detail-meta" });
    var rows = [];

    if (price) {
      rows.push(
        "Estimated value: Median " +
          formatPrice(price.currency, price.median) +
          " · Max " +
          formatPrice(price.currency, price.high)
      );
    }
    if (details.artists && details.artists.length) {
      rows.push("Artist: " + details.artists.map(function (a) { return a.name; }).join(", "));
    }
    if (details.country) rows.push("Country: " + details.country);
    if (details.released) rows.push("Released: " + details.released);
    if (details.genres && details.genres.length) rows.push("Genres: " + details.genres.join(", "));
    if (details.styles && details.styles.length) rows.push("Styles: " + details.styles.join(", "));
    if (details.labels && details.labels.length) {
      rows.push("Label: " + details.labels.map(function (l) { return l.name; }).join(", "));
      var catnos = details.labels
        .map(function (l) { return l.catno; })
        .filter(Boolean)
        .join(", ");
      if (catnos) rows.push("Catalog #: " + catnos);
    }
    if (details.formats && details.formats.length) {
      rows.push(
        "Format: " +
          details.formats
            .map(function (f) {
              return joinDefined(
                [f.name, f.qty !== "1" ? "x" + f.qty : null].concat(f.descriptions || []),
                " "
              );
            })
            .join(", ")
      );
    }
    if (details.identifiers && details.identifiers.length) {
      rows.push(
        details.identifiers
          .map(function (id) { return (id.description || id.type) + ": " + id.value; })
          .join(" · ")
      );
    }
    if (details.community) {
      var stats = "Collection stats: " + details.community.have + " have, " + details.community.want + " want";
      if (details.community.rating && details.community.rating.count > 0) {
        stats +=
          " · rated " +
          Number(details.community.rating.average).toFixed(2) +
          "/5 (" +
          details.community.rating.count +
          ")";
      }
      rows.push(stats);
    }
    if (details.data_quality) rows.push("Data quality: " + details.data_quality);
    if (details.master_id) rows.push("Master release ID: " + details.master_id);

    rows.forEach(function (row) {
      meta.appendChild(el("div", { text: row }));
    });
    detail.appendChild(meta);

    if (details.tracklist && details.tracklist.length) {
      var list = el("ol", { class: "tracklist" });
      details.tracklist.forEach(function (track) {
        list.appendChild(
          el("li", null, [
            el("span", { class: "track-position", text: track.position || "" }),
            el("span", { class: "track-title", text: track.title || "" }),
            track.duration ? el("span", { class: "track-duration", text: track.duration }) : null
          ])
        );
      });
      detail.appendChild(list);
    }

    if (details.notes) {
      detail.appendChild(el("p", { class: "result-detail-notes", text: details.notes }));
    }

    if (details.videos && details.videos.length) {
      var videoList = el("div", { class: "video-list" });
      details.videos.forEach(function (video) {
        var youtubeId = getYoutubeId(video.uri);
        if (!youtubeId) return;
        videoList.appendChild(
          el("div", { class: "video-item" }, [
            el("div", { class: "video-embed" }, [
              el("iframe", {
                src: "https://www.youtube.com/embed/" + youtubeId,
                title: video.title || "",
                loading: "lazy",
                allow: "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
                allowfullscreen: true
              })
            ]),
            el("div", { class: "video-title", text: video.title || "" })
          ])
        );
      });
      if (videoList.childNodes.length) detail.appendChild(videoList);
    }

    return detail;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  var root, resultsContainer;

  function renderResults() {
    if (!resultsContainer) return;
    clear(resultsContainer);
    state.results.forEach(function (result) {
      resultsContainer.appendChild(buildResultCard(result));
    });
  }

  function buildCaptureBox() {
    var cameraInput = el("input", {
      type: "file",
      accept: "image/*",
      capture: "environment",
      style: { display: "none" }
    });
    var galleryInput = el("input", { type: "file", accept: "image/*", style: { display: "none" } });

    [cameraInput, galleryInput].forEach(function (input) {
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (file) handleFile(file);
      });
    });

    // Two separate inputs: one input carrying `capture` sent Android straight
    // into the camera app and hid the gallery option entirely.
    var cameraButton = el("button", { style: { flex: "1" }, text: "Use camera" });
    cameraButton.addEventListener("click", function () {
      cameraInput.click();
    });

    var galleryButton = el("button", { class: "secondary", style: { flex: "1" }, text: "Choose photo" });
    galleryButton.addEventListener("click", function () {
      galleryInput.click();
    });

    return el("div", { class: "capture-box" }, [
      el("p", { text: "Take a photo of the record cover, label, or barcode." }),
      cameraInput,
      galleryInput,
      el("div", { style: { display: "flex", gap: "8px" } }, [cameraButton, galleryButton])
    ]);
  }

  function activeSearchFields() {
    var fields = [
      { label: "artist", value: state.reviewFields.artist.trim() },
      { label: "release_title", value: state.reviewFields.title.trim() },
      { label: "label", value: state.reviewFields.label.trim() },
      { label: "catno", value: state.reviewFields.catalogNumber.trim() }
    ];
    return fields.filter(function (f) {
      return f.value !== "";
    });
  }

  function queryPreviewText() {
    var fields = activeSearchFields();
    if (!fields.length) return "No fields set — add at least one before searching.";
    return (
      "Discogs search will use: " +
      fields
        .map(function (f) {
          return f.label + '="' + f.value + '"';
        })
        .join(", ")
    );
  }

  function buildReviewBox() {
    var box = el("div", { class: "review-box" }, [
      el("h2", { text: "Review search terms" }),
      el("p", {
        class: "status",
        text:
          "Edit any field before searching. Fewer fields cast a wider net; more fields narrow it down — " +
          "clear a field if Discogs isn't finding a match."
      })
    ]);

    var preview = el("div", { class: "query-preview", text: queryPreviewText() });

    var fieldDefs = [
      { id: "review-artist", label: "Artist", key: "artist" },
      { id: "review-title", label: "Release title", key: "title" },
      { id: "review-label", label: "Label", key: "label" },
      { id: "review-catno", label: "Catalogue number", key: "catalogNumber" }
    ];

    fieldDefs.forEach(function (def) {
      var input = el("input", { id: def.id, type: "text", value: state.reviewFields[def.key] });
      // Bound directly rather than via a re-render, so typing never loses focus.
      input.addEventListener("input", function () {
        state.reviewFields[def.key] = input.value;
        preview.textContent = queryPreviewText();
      });
      box.appendChild(
        el("div", { class: "field-group" }, [el("label", { for: def.id, text: def.label }), input])
      );
    });

    box.appendChild(preview);

    var searchButton = el("button", {
      style: { width: "100%" },
      text: state.stage === "searching" ? "Searching…" : "Search Discogs",
      disabled: state.stage === "searching"
    });
    searchButton.addEventListener("click", runSearch);
    box.appendChild(searchButton);

    return box;
  }

  function render() {
    clear(root);

    var restartButton = el("button", { class: "secondary", text: "↺ Restart" });
    restartButton.addEventListener("click", reset);
    root.appendChild(el("div", { class: "restart-bar" }, [restartButton]));

    if (!state.imageUrl) {
      root.appendChild(buildCaptureBox());
    } else {
      root.appendChild(el("img", { src: state.imageUrl, alt: "Captured record", class: "preview" }));
    }

    if (state.stage === "scanning-barcode") {
      root.appendChild(el("p", { class: "status", text: "Scanning for a barcode…" }));
    }
    if (state.stage === "identifying") {
      root.appendChild(el("p", { class: "status", text: "Reading the cover with Gemini…" }));
    }
    if (state.stage === "searching" && !state.identified) {
      root.appendChild(el("p", { class: "status", text: "Searching Discogs…" }));
    }

    if (state.identified && (state.identified.artist || state.identified.title)) {
      root.appendChild(
        el("div", { class: "identified-box" }, [
          el("strong", {
            text:
              (state.identified.artist || "Unknown artist") +
              " — " +
              (state.identified.title || "Unknown title")
          }),
          state.identified.format ? el("div", { text: "Format: " + state.identified.format }) : null,
          state.identified.notes
            ? el("div", { style: { color: "var(--muted)" }, text: state.identified.notes })
            : null
        ])
      );
    }

    if ((state.stage === "review" || state.stage === "searching") && state.identified) {
      root.appendChild(buildReviewBox());
    }

    if (state.error) {
      root.appendChild(el("p", { class: "error", text: state.error }));
    }

    if (state.stage === "no-match") {
      var editButton = el("button", {
        class: "secondary",
        style: { width: "100%" },
        text: "← Edit search terms"
      });
      editButton.addEventListener("click", function () {
        state.stage = "review";
        render();
      });
      root.appendChild(
        el("div", null, [
          el("p", {
            class: "status",
            text: "No matches found on Discogs. Try adjusting the search terms below."
          }),
          editButton
        ])
      );
    }

    resultsContainer = el("div");
    root.appendChild(resultsContainer);
    renderResults();

    var busy =
      state.stage === "scanning-barcode" || state.stage === "identifying" || state.stage === "searching";

    if (state.imageUrl && !busy) {
      var againButton = el("button", {
        class: "secondary",
        style: { marginTop: "8px", width: "100%" },
        text: "Scan another record"
      });
      againButton.addEventListener("click", reset);
      root.appendChild(againButton);
    }
  }

  function init() {
    root = document.getElementById("app");
    if (root) render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
