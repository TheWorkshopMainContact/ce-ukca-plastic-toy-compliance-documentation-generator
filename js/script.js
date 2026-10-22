/*jshint esversion: 6*/
/*global window */

/* UKCA Declaration of Conformity generator.
   Validates the form, then builds a one-page A4 PDF with jsPDF. */

(function () {
    "use strict";

    /* ---------- Constants ---------- */
    var MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
    var MAX_IMAGE_PIXELS = 1200; // Longest side after shrinking
    var ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

    var SIGNATURE_PATH = "assets/images/gwensignature.png";
    var SIGNATURE_MAX_WIDTH = 45; // Millimetres on the PDF
    var SIGNATURE_MAX_HEIGHT = 11;

    // Required text fields and the names used in error messages
    var REQUIRED_FIELDS = [
        {id: "product-name", label: "Toy name"},
        {id: "model-no", label: "Model number"},
        {id: "age-suitability", label: "Age suitability"},
        {id: "business-name", label: "Business name"},
        {id: "business-address", label: "Business address"},
        {id: "first-name", label: "First name"},
        {id: "last-name", label: "Last name"},
        {id: "position", label: "Position"},
        {id: "town-city", label: "Town or city"},
        {id: "region", label: "Region"},
        {id: "country", label: "Country"},
        {id: "date-of-issue", label: "Date of issue"},
        {id: "document-reference", label: "Document reference"}
    ];

    // Standards printed on every declaration, as in the UKCA template
    var STANDARDS = [
        {ref: "BS EN71-1", title: "Safety of Toys \u2013 Part 1: Mechanical and physical properties", edition: "2014+A1:2018"},
        {ref: "BS EN71-2", title: "Safety of Toys \u2013 Part 2: Flammability", edition: "2020+A1:2025"},
        {ref: "BS EN71-3", title: "Safety of Toys \u2013 Part 3: Migration of certain elements", edition: "2019+A2:2025"}
    ];

    var form = document.getElementById("doc-form");
    var photoInput = document.getElementById("toy-photo");
    var photoPreview = document.getElementById("photo-preview");
    var statusBox = document.getElementById("form-status");
    var generateBtn = document.getElementById("generate-btn");

    /* ---------- Helpers ---------- */

    // Returns the trimmed text in a field
    function getValue(id) {
        return document.getElementById(id).value.trim();
    }

    // Shows an error under a field, or clears it when the message is empty
    function setError(id, message) {
        var input = document.getElementById(id);
        document.getElementById(id + "-error").textContent = message;
        input.classList.toggle("invalid", message !== "");
        input.setAttribute("aria-invalid", message !== "" ? "true" : "false");
    }

    // Shows a message under the buttons; type is "success", "failure" or empty
    function setStatus(message, type) {
        statusBox.textContent = message;
        statusBox.className = "status" + (type ? " " + type : "");
    }

    // Turns 2026-12-31 into 31/12/2026
    function formatDate(isoDate) {
        var parts = isoDate.split("-");
        return parts[2] + "/" + parts[1] + "/" + parts[0];
    }

    // Builds a safe file name from the document reference
    function makeFileName(reference) {
        var safe = reference.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        return "ukca-declaration-of-conformity-" + (safe || "document") + ".pdf";
    }

    // Fills the date box with today's date
    function setDefaultDate() {
        var now = new Date();
        var month = String(now.getMonth() + 1).padStart(2, "0");
        var day = String(now.getDate()).padStart(2, "0");
        document.getElementById("date-of-issue").value = now.getFullYear() + "-" + month + "-" + day;
    }

    /* ---------- Validation ---------- */

    // Checks every field; returns the first invalid id, or "" if all are valid
    function validateForm() {
        var firstInvalid = "";
        var photoMessage = "";
        var file = photoInput.files[0];

        REQUIRED_FIELDS.forEach(function (field) {
            var message = "";
            if (getValue(field.id) === "") {
                message = field.label + " is required.";
            }
            setError(field.id, message);
            if (message !== "" && firstInvalid === "") {
                firstInvalid = field.id;
            }
        });

        if (!file) {
            photoMessage = "Choose a photo of the toy.";
        } else if (ALLOWED_PHOTO_TYPES.indexOf(file.type) === -1) {
            photoMessage = "The photo must be a JPG, PNG or WebP file.";
        } else if (file.size > MAX_PHOTO_BYTES) {
            photoMessage = "The photo must be smaller than 5 MB.";
        }
        setError("toy-photo", photoMessage);
        if (photoMessage !== "" && firstInvalid === "") {
            firstInvalid = "toy-photo";
        }

        return firstInvalid;
    }

    /* ---------- Image handling ---------- */

    // Shrinks an image on a canvas and returns its data URL and size
    function imageToData(img, background, mime) {
        var scale = Math.min(1, MAX_IMAGE_PIXELS / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        var ctx = canvas.getContext("2d");

        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        if (background) {
            ctx.fillStyle = background; // Stops transparent areas turning black in a JPEG
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return {
            dataUrl: canvas.toDataURL(mime, 0.85),
            width: canvas.width,
            height: canvas.height
        };
    }

    // Reads the chosen photo and returns it as a shrunken JPEG
    function loadPhoto(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () {
                reject(new Error("The photo could not be read."));
            };
            reader.onload = function () {
                var img = new Image();
                img.onerror = function () {
                    reject(new Error("The photo could not be opened. Try a different image."));
                };
                img.onload = function () {
                    resolve(imageToData(img, "#ffffff", "image/jpeg"));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // Loads the signature image; resolves to null if it is missing or blocked
    function loadSignature() {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onerror = function () {
                resolve(null);
            };
            img.onload = function () {
                try {
                    resolve(imageToData(img, "", "image/png")); // PNG keeps transparency
                } catch (ignore) {
                    resolve(null); // Some browsers block canvas use for local files
                }
            };
            img.src = SIGNATURE_PATH;
        });
    }

    // Shows a preview when a valid photo is chosen
    function updatePhotoPreview() {
        var file = photoInput.files[0];
        if (file && ALLOWED_PHOTO_TYPES.indexOf(file.type) !== -1 && file.size <= MAX_PHOTO_BYTES) {
            photoPreview.src = URL.createObjectURL(file);
            photoPreview.hidden = false;
            setError("toy-photo", "");
        } else {
            photoPreview.hidden = true;
            photoPreview.removeAttribute("src");
        }
    }

    /* ---------- PDF drawing ---------- */
    // Positions are in millimetres on an A4 page

    // Draws wrapped text; returns the y position below the last line
    function drawWrapped(doc, text, x, y, width, lineHeight) {
        var lines = doc.splitTextToSize(text, width);
        doc.text(lines, x, y);
        return y + lines.length * lineHeight;
    }

    // Draws one centred line made of italic and bold parts
    function drawCentredMixed(doc, parts, y, centreX) {
        var total = 0;
        var x;
        parts.forEach(function (part) {
            doc.setFont("times", part.style);
            part.width = doc.getTextWidth(part.text);
            total += part.width;
        });
        x = centreX - total / 2;
        parts.forEach(function (part) {
            doc.setFont("times", part.style);
            doc.text(part.text, x, y);
            x += part.width;
        });
    }

    // Title, manufacturer details and directive; returns the y below them
    function drawHeader(doc, data) {
        var centreX = 105;
        var y;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("Declaration of Conformity", centreX, 22, {align: "center"});
        doc.setFont("helvetica", "normal");
        doc.setFontSize(14);
        doc.text("in accordance with Toys (Safety) Regulations 2011", centreX, 30, {align: "center"});
        doc.text("(S.I. 2011/1881)", centreX, 37, {align: "center"});
        doc.setLineWidth(0.4);
        doc.line(20, 42, 190, 42);

        doc.setFontSize(10);
        drawCentredMixed(doc, [
            {text: "Manufacturer / Authorised Representative: ", style: "italic"},
            {text: data.businessName, style: "bold"}
        ], 50, centreX);
        drawCentredMixed(doc, [
            {text: "of ", style: "italic"},
            {text: data.businessAddress, style: "bold"}
        ], 55, centreX);

        doc.setFont("times", "italic");
        y = drawWrapped(doc, "This declaration of conformity is issued under the sole responsibility of the manufacturer in accordance with the following Directive(s):", 20, 65, 170, 4.5);
        doc.setFont("helvetica", "bold");
        doc.text("S.I. 2011/1881", 75, y + 2);
        doc.text("Toys (Safety) Regulations 2011", 105, y + 2);
        doc.line(20, y + 8, 190, y + 8);
        return y + 8;
    }

    // Product name, model number and photo; returns the y below them
    function drawProduct(doc, data, photo, startY) {
        var y = startY + 9;
        var maxW = 100;
        var maxH = 62;
        var ratio = Math.min(maxW / photo.width, maxH / photo.height);
        var w = photo.width * ratio;
        var h = photo.height * ratio;
        var lastY;
        var photoTop;

        doc.setFont("times", "italic");
        doc.setFontSize(10);
        doc.text("It is hereby declared that:", 20, y);

        doc.setFont("helvetica", "normal");
        doc.text("Product:", 85, y);
        doc.text("Model No:", 85, y + 6);
        doc.setFont("helvetica", "bold");
        lastY = drawWrapped(doc, data.productName, 112, y, 78, 4.5);
        lastY = drawWrapped(doc, data.modelNo, 112, Math.max(lastY, y + 5.5) + 1.5, 78, 4.5);

        // Photo is centred in a fixed-height area below the details
        photoTop = lastY + 3;
        doc.addImage(photo.dataUrl, "JPEG", 105 - w / 2, photoTop + (maxH - h) / 2, w, h);
        return photoTop + maxH + 4;
    }

    // Standards table, age suitability and declaration; returns the y below them
    function drawStandards(doc, data, startY) {
        var y = startY;

        doc.setFont("times", "italic");
        doc.setFontSize(10);
        y = drawWrapped(doc, "is in conformity with the applicable requirements of the following harmonised documents as a part of the European Standards:", 20, y, 170, 4.5);

        y += 4;
        doc.setFont("helvetica", "normal");
        doc.text("Ref. No.", 20, y);
        doc.text("Title", 42, y);
        doc.text("Edition", 190, y, {align: "right"});
        doc.setFont("helvetica", "bold");
        STANDARDS.forEach(function (standard, index) {
            var rowY = y + 5 + index * 5;
            doc.text(standard.ref, 20, rowY);
            doc.text(standard.title, 42, rowY);
            doc.text(standard.edition, 190, rowY, {align: "right"});
        });
        y += 5 + STANDARDS.length * 5 + 3;

        doc.setFont("helvetica", "normal");
        doc.text("Additional information:", 20, y);
        doc.setFont("helvetica", "bold");
        y = drawWrapped(doc, data.ageSuitability, 62, y, 128, 4.5);

        y += 3;
        doc.setFont("times", "italic");
        return drawWrapped(doc, "I hereby declare that the toy named has been designed to comply with the relevant sections of the above harmonised standards specified and the applicable Essential Requirements of the Toy Safety Directive.", 20, y, 170, 4.5);
    }

    // Signature, signer details, UKCA mark and footer
    function drawSignature(doc, data, signature, startY) {
        var y = Math.max(startY + 8, 238);
        var ratio;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Signed:", 20, y);

        if (signature) {
            ratio = Math.min(SIGNATURE_MAX_WIDTH / signature.width, SIGNATURE_MAX_HEIGHT / signature.height);
            doc.addImage(signature.dataUrl, "PNG", 36, y + 1.5 - signature.height * ratio, signature.width * ratio, signature.height * ratio);
        } else {
            // Fallback: first initial and surname in a script-style italic
            doc.setFont("times", "bolditalic");
            doc.setFontSize(18);
            doc.text(data.firstName.charAt(0) + data.lastName, 36, y);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
        }

        y += 12;
        doc.text("Name:", 20, y);
        doc.text("Position:", 20, y + 7);
        doc.text("Place of issue:", 75, y);
        doc.text("Date of issue:", 75, y + 7);

        doc.setFont("helvetica", "bold");
        doc.text(data.firstName + " " + data.lastName, 31, y, {maxWidth: 42});
        doc.text(data.position, 36, y + 7, {maxWidth: 37});
        doc.text(data.townCity + ", " + data.region + ", " + data.country, 100, y, {maxWidth: 50});
        doc.text(formatDate(data.dateOfIssue), 100, y + 7);

        // UKCA mark, drawn as large bold text
        doc.setFontSize(46);
        doc.text("UK", 190, y - 3, {align: "right"});
        doc.text("CA", 190, y + 14, {align: "right"});

        doc.setFontSize(9);
        doc.line(20, 278, 160, 278);
        doc.text(data.documentReference + " | " + data.productName + " / " + data.modelNo, 20, 283, {maxWidth: 140});
        doc.text(data.businessName, 20, 288, {maxWidth: 140});
    }

    // Builds the whole PDF and downloads it
    function buildPdf(data, photo, signature) {
        var doc = new window.jspdf.jsPDF({unit: "mm", format: "a4"});
        var y = drawHeader(doc, data);
        y = drawProduct(doc, data, photo, y);
        y = drawStandards(doc, data, y);
        drawSignature(doc, data, signature, y);
        doc.save(makeFileName(data.documentReference));
    }

    /* ---------- Event handlers ---------- */

    // Runs when Download PDF is clicked
    function handleSubmit(event) {
        var firstInvalid;
        var data = {};

        event.preventDefault();
        setStatus("", "");

        firstInvalid = validateForm();
        if (firstInvalid !== "") {
            setStatus("Fix the highlighted fields and try again.", "failure");
            document.getElementById(firstInvalid).focus();
            return;
        }

        if (!window.jspdf) {
            setStatus("The PDF library did not load. Check your internet connection and refresh the page.", "failure");
            return;
        }

        generateBtn.disabled = true; // Prevents a second click while working
        setStatus("Creating your PDF\u2026", "");

        REQUIRED_FIELDS.forEach(function (field) {
            // Turns "product-name" into "productName"
            var key = field.id.replace(/-([a-z])/g, function (match, letter) {
                return letter.toUpperCase();
            });
            data[key] = getValue(field.id);
        });

        Promise.all([loadPhoto(photoInput.files[0]), loadSignature()]).then(function (results) {
            buildPdf(data, results[0], results[1]);
            setStatus("Your PDF has been downloaded.", "success");
        }).catch(function (error) {
            setStatus(error.message || "Something went wrong while creating the PDF.", "failure");
        }).then(function () {
            generateBtn.disabled = false;
        });
    }

    // Runs when Clear form is clicked
    function handleReset() {
        // Waits for the browser to clear the fields first
        window.setTimeout(function () {
            REQUIRED_FIELDS.forEach(function (field) {
                setError(field.id, "");
            });
            setError("toy-photo", "");
            photoPreview.hidden = true;
            photoPreview.removeAttribute("src");
            setDefaultDate();
            setStatus("", "");
        }, 0);
    }

    /* ---------- Start-up ---------- */
    form.addEventListener("submit", handleSubmit);
    form.addEventListener("reset", handleReset);
    photoInput.addEventListener("change", updatePhotoPreview);
    setDefaultDate();
}());