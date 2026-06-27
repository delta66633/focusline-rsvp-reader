(function () {
  "use strict";

  const STORAGE_KEYS = {
    activeBookId: "focusline.active-book.v1",
    draft: "focusline.draft.v1",
    draftTitle: "focusline.draft-title.v1",
    settings: "focusline.settings.v1",
    readerHintSeen: "focusline.reader-hint-seen.v1",
  };

  const DEFAULT_SAMPLE = `십이월은 모든 달 가운데 가장 잔인한 달이다.
죽은 땅에서 라일락을 키우고
추억과 욕망을 뒤섞고
나른한 뿌리를 봄비로 깨운다.

겨울이 우리를 따뜻하게 해 주었다.
망각의 눈으로 대지를 덮고
마른 구근들로 약간의 목숨을 주었다.`;

  const DEFAULT_SETTINGS = {
    wpm: 300,
    longWordPacing: true,
    punctuationPacing: true,
    focusHighlight: true,
    highContrastFocus: false,
    context: "both",
    theme: "dark",
    fontSize: 100,
    tracking: 0,
    typeface: "serif",
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    books: [],
    currentBook: null,
    editorDirty: false,
    pendingDeleteId: null,
    tokens: [],
    durations: [],
    prefixDurations: [],
    index: 0,
    playing: false,
    hasPlayed: false,
    ended: false,
    timerId: 0,
    wordStartedAt: 0,
    readStartedAt: 0,
    remainingMs: 0,
    controlsTimerId: 0,
    holdDelayId: 0,
    holdRepeatId: 0,
    holdPointerId: null,
    holdButton: null,
    stagePointer: null,
    progressSaveTimerId: 0,
    toastTimerId: 0,
    wakeLock: null,
  };

  const dom = {
    setupView: document.querySelector("#setupView"),
    newBookButton: document.querySelector("#newBookButton"),
    libraryButton: document.querySelector("#libraryButton"),
    libraryButtonCount: document.querySelector("#libraryButtonCount"),
    bookTitle: document.querySelector("#bookTitle"),
    currentBookStatus: document.querySelector("#currentBookStatus"),
    resetProgressButton: document.querySelector("#resetProgressButton"),
    readerView: document.querySelector("#readerView"),
    sourceText: document.querySelector("#sourceText"),
    characterCount: document.querySelector("#characterCount"),
    cleanTextButton: document.querySelector("#cleanTextButton"),
    editorError: document.querySelector("#editorError"),
    wpmRange: document.querySelector("#wpmRange"),
    wpmOutput: document.querySelector("#wpmOutput"),
    wpmDown: document.querySelector("#wpmDown"),
    wpmUp: document.querySelector("#wpmUp"),
    longWordToggle: document.querySelector("#longWordToggle"),
    punctuationToggle: document.querySelector("#punctuationToggle"),
    focusToggle: document.querySelector("#focusToggle"),
    highContrastFocusToggle: document.querySelector("#highContrastFocusToggle"),
    fontSizeRange: document.querySelector("#fontSizeRange"),
    fontSizeOutput: document.querySelector("#fontSizeOutput"),
    trackingRange: document.querySelector("#trackingRange"),
    trackingOutput: document.querySelector("#trackingOutput"),
    typefaceSelect: document.querySelector("#typefaceSelect"),
    saveBookButton: document.querySelector("#saveBookButton"),
    startButton: document.querySelector("#startButton"),
    libraryLayer: document.querySelector("#libraryLayer"),
    libraryBackdrop: document.querySelector("#libraryBackdrop"),
    libraryDrawer: document.querySelector("#libraryDrawer"),
    libraryCount: document.querySelector("#libraryCount"),
    libraryList: document.querySelector("#libraryList"),
    libraryEmpty: document.querySelector("#libraryEmpty"),
    libraryEmptyAction: document.querySelector("#libraryEmptyAction"),
    libraryExportButton: document.querySelector("#libraryExportButton"),
    libraryImportButton: document.querySelector("#libraryImportButton"),
    libraryImportInput: document.querySelector("#libraryImportInput"),
    libraryNewBookButton: document.querySelector("#libraryNewBookButton"),
    libraryCloseButton: document.querySelector("#libraryCloseButton"),
    toast: document.querySelector("#toast"),
    readerStage: document.querySelector("#readerStage"),
    previousHoldButton: document.querySelector("#previousHoldButton"),
    nextHoldButton: document.querySelector("#nextHoldButton"),
    previousWord: document.querySelector("#previousWord"),
    nextWord: document.querySelector("#nextWord"),
    wordMain: document.querySelector("#wordMain"),
    wordBefore: document.querySelector("#wordBefore"),
    wordFocus: document.querySelector("#wordFocus"),
    wordAfter: document.querySelector("#wordAfter"),
    readerWpm: document.querySelector("#readerWpm"),
    readerWpmDown: document.querySelector("#readerWpmDown"),
    readerWpmUp: document.querySelector("#readerWpmUp"),
    readerHelpButton: document.querySelector("#readerHelpButton"),
    readerHelpOverlay: document.querySelector("#readerHelpOverlay"),
    readerHelpDismissButton: document.querySelector("#readerHelpDismissButton"),
    exitButton: document.querySelector("#exitButton"),
    playButton: document.querySelector("#playButton"),
    playLabel: document.querySelector("#playLabel"),
    rewindButton: document.querySelector("#rewindButton"),
    progressRange: document.querySelector("#progressRange"),
    progressOutput: document.querySelector("#progressOutput"),
    remainingTime: document.querySelector("#remainingTime"),
    portraitContinueButton: document.querySelector("#portraitContinueButton"),
    portraitExitButton: document.querySelector("#portraitExitButton"),
  };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "null");
      if (saved && typeof saved === "object") {
        state.settings = { ...DEFAULT_SETTINGS, ...saved };
      }
    } catch (_error) {
      state.settings = { ...DEFAULT_SETTINGS };
    }

    state.settings.wpm = clamp(Number(state.settings.wpm) || 300, 10, 1000);
    state.settings.fontSize = clamp(Number(state.settings.fontSize) || 100, 70, 130);
    state.settings.tracking = clamp(Number(state.settings.tracking) || 0, -2, 3);
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }

  function showToast(message, isError = false) {
    window.clearTimeout(state.toastTimerId);
    dom.toast.textContent = message;
    dom.toast.classList.toggle("is-error", isError);
    dom.toast.hidden = false;
    state.toastTimerId = window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 2400);
  }

  function deriveBookTitle(content) {
    const firstLine = String(content).split(/\r?\n/u).find((line) => line.trim()) || "제목 없는 책";
    return Array.from(firstLine.trim()).slice(0, 36).join("") || "제목 없는 책";
  }

  function bookProgressPercent(book) {
    if (!book || !book.wordCount) return 0;
    if (book.completed) return 100;
    if (book.wordCount === 1) return 0;
    return clamp(Math.round((book.lastReadIndex / (book.wordCount - 1)) * 100), 0, 100);
  }

  function lastReadLabel(timestamp) {
    if (!timestamp) return "마지막 읽기 없음";
    const date = new Date(timestamp);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayDifference = Math.round((startOfToday - startOfDate) / 86400000);
    if (dayDifference === 0) return "마지막 읽기 오늘";
    if (dayDifference === 1) return "마지막 읽기 어제";
    return `마지막 읽기 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  }

  function bookTargetWpm(book) {
    return clamp(Math.round(Number(book?.targetWpm) || state.settings.wpm), 10, 1000);
  }

  function formatBookReadTime(milliseconds) {
    const totalMinutes = Math.floor(Math.max(0, Number(milliseconds) || 0) / 60000);
    if (totalMinutes < 1) return "읽기 시작 전";
    if (totalMinutes < 60) return `읽기 ${totalMinutes}분`;
    return `읽기 ${Math.floor(totalMinutes / 60)}시간 ${totalMinutes % 60}분`;
  }

  function updateEditorBookStatus() {
    if (!state.currentBook) {
      dom.currentBookStatus.textContent = "저장하지 않은 글";
      dom.resetProgressButton.hidden = true;
      dom.saveBookButton.textContent = "책 저장";
      dom.startButton.textContent = "읽기 시작";
      return;
    }

    const progress = bookProgressPercent(state.currentBook);
    const progressText = progress >= 100 ? "완독" : `${progress}% 읽음`;
    dom.currentBookStatus.textContent = `${progressText} · ${formatBookReadTime(state.currentBook.readMilliseconds)} · ${bookTargetWpm(state.currentBook)}WPM`;
    dom.resetProgressButton.hidden = state.currentBook.lastReadIndex <= 0;
    dom.saveBookButton.textContent = "변경사항 저장";
    dom.startButton.textContent = progress >= 100
      ? "다시 읽기"
      : state.currentBook.lastReadIndex > 0
        ? "이어 읽기"
        : "읽기 시작";
  }

  function makeLibraryButton(label, action, bookId, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.bookId = bookId;
    if (className) button.className = className;
    return button;
  }

  function renderLibrary() {
    dom.libraryList.replaceChildren();
    dom.libraryEmpty.hidden = state.books.length > 0;
    dom.libraryEmptyAction.textContent = dom.sourceText.value.trim() ? "현재 글 저장하기" : "글 붙여넣기";
    dom.libraryCount.value = `${state.books.length}권`;
    dom.libraryButtonCount.value = String(state.books.length);

    state.books.forEach((book) => {
      const progress = bookProgressPercent(book);
      const row = document.createElement("article");
      row.className = "library-book";
      row.dataset.bookId = book.id;

      const heading = document.createElement("div");
      heading.className = "library-book-heading";
      const title = document.createElement("h3");
      title.textContent = book.title;
      const progressLabel = document.createElement("span");
      progressLabel.textContent = progress >= 100 ? "완독" : `${progress}% 읽음`;
      heading.append(title, progressLabel);

      const progressTrack = document.createElement("div");
      progressTrack.className = "library-progress";
      const progressBar = document.createElement("span");
      progressBar.style.width = `${progress}%`;
      progressTrack.append(progressBar);

      const metadata = document.createElement("p");
      metadata.textContent = [
        lastReadLabel(book.lastReadAt),
        `${book.wordCount.toLocaleString("ko-KR")}단어`,
        formatBookReadTime(book.readMilliseconds),
        `목표 ${bookTargetWpm(book)}WPM`,
      ].join(" · ");

      const actions = document.createElement("div");
      actions.className = "library-book-actions";
      if (progress >= 100) {
        actions.append(makeLibraryButton("다시 읽기", "restart", book.id, "is-primary"));
      } else {
        actions.append(makeLibraryButton(progress > 0 ? "이어 읽기" : "읽기", "read", book.id, "is-primary"));
        if (progress > 0) actions.append(makeLibraryButton("처음부터", "restart", book.id));
      }
      actions.append(makeLibraryButton("수정", "edit", book.id));
      actions.append(makeLibraryButton("삭제", "delete", book.id));

      row.append(heading, progressTrack, metadata, actions);

      if (state.pendingDeleteId === book.id) {
        const confirmation = document.createElement("div");
        confirmation.className = "library-delete-confirmation";
        const question = document.createElement("span");
        question.textContent = "이 책을 삭제할까요?";
        confirmation.append(
          question,
          makeLibraryButton("취소", "cancel-delete", book.id),
          makeLibraryButton("삭제", "confirm-delete", book.id, "is-danger"),
        );
        row.append(confirmation);
      }

      dom.libraryList.append(row);
    });
  }

  async function refreshLibrary() {
    try {
      state.books = await window.FocuslineLibrary.listBooks();
      renderLibrary();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "서재를 불러오지 못했습니다.", true);
    }
  }

  async function openLibrary() {
    state.pendingDeleteId = null;
    await refreshLibrary();
    dom.libraryLayer.hidden = false;
    document.body.classList.add("library-open");
    dom.libraryCloseButton.focus();
  }

  function closeLibrary() {
    if (dom.libraryLayer.hidden) return;
    dom.libraryLayer.hidden = true;
    document.body.classList.remove("library-open");
    state.pendingDeleteId = null;
    dom.libraryButton.focus();
  }

  function loadBookIntoEditor(book, focusEditor = false) {
    window.clearTimeout(state.progressSaveTimerId);
    state.progressSaveTimerId = 0;
    state.currentBook = { ...book };
    state.settings.wpm = bookTargetWpm(book);
    state.editorDirty = false;
    dom.bookTitle.value = book.title;
    dom.sourceText.value = book.content;
    localStorage.setItem(STORAGE_KEYS.activeBookId, book.id);
    localStorage.setItem(STORAGE_KEYS.draft, book.content);
    localStorage.setItem(STORAGE_KEYS.draftTitle, book.title);
    syncControlsFromSettings();
    updateCharacterCount();
    updateEditorBookStatus();
    closeLibrary();
    if (focusEditor) dom.bookTitle.focus();
  }

  function createNewBook(force = false) {
    const hasUnsavedWork = state.editorDirty && (dom.bookTitle.value.trim() || dom.sourceText.value.trim());
    if (!force && hasUnsavedWork && !window.confirm("저장하지 않은 변경사항이 있습니다. 새 책을 만들까요?")) {
      return;
    }

    window.clearTimeout(state.progressSaveTimerId);
    state.progressSaveTimerId = 0;
    state.currentBook = null;
    state.editorDirty = false;
    state.pendingDeleteId = null;
    dom.bookTitle.value = "";
    dom.sourceText.value = "";
    localStorage.removeItem(STORAGE_KEYS.activeBookId);
    localStorage.setItem(STORAGE_KEYS.draft, "");
    localStorage.setItem(STORAGE_KEYS.draftTitle, "");
    updateCharacterCount();
    updateEditorBookStatus();
    if (!dom.libraryLayer.hidden) closeLibrary();
    dom.bookTitle.focus();
  }

  async function saveCurrentBook(options = {}) {
    const content = dom.sourceText.value.trim();
    if (!content) {
      dom.sourceText.setAttribute("aria-invalid", "true");
      dom.editorError.textContent = "저장할 글을 입력해 주세요.";
      dom.sourceText.focus();
      return null;
    }

    const now = Date.now();
    const tokens = tokenizeText(content);
    const previous = state.currentBook;
    const record = {
      id: previous?.id,
      title: dom.bookTitle.value.trim() || deriveBookTitle(content),
      content,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      lastReadAt: previous?.lastReadAt || 0,
      lastReadIndex: clamp(previous?.lastReadIndex || 0, 0, Math.max(0, tokens.length - 1)),
      wordCount: tokens.length,
      readMilliseconds: previous?.readMilliseconds || 0,
      targetWpm: state.settings.wpm,
      completed: Boolean(previous?.completed && previous.content === content),
    };

    try {
      const saved = await window.FocuslineLibrary.saveBook(record);
      state.currentBook = saved;
      state.editorDirty = false;
      dom.bookTitle.value = saved.title;
      localStorage.setItem(STORAGE_KEYS.activeBookId, saved.id);
      localStorage.setItem(STORAGE_KEYS.draft, saved.content);
      localStorage.setItem(STORAGE_KEYS.draftTitle, saved.title);
      updateEditorBookStatus();
      await refreshLibrary();
      if (!options.quiet) showToast(previous ? "변경사항을 저장했습니다." : "책을 서재에 저장했습니다.");
      return saved;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "책을 저장하지 못했습니다.", true);
      return null;
    }
  }

  async function resetCurrentProgress() {
    if (!state.currentBook) return;
    try {
      const updated = await window.FocuslineLibrary.updateProgress(
        state.currentBook.id,
        0,
        tokenizeText(state.currentBook.content).length,
        false,
        {
          readMilliseconds: state.currentBook.readMilliseconds,
          targetWpm: bookTargetWpm(state.currentBook),
        },
      );
      if (updated) state.currentBook = updated;
      updateEditorBookStatus();
      await refreshLibrary();
      showToast("처음부터 읽도록 되돌렸습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "진행률을 초기화하지 못했습니다.", true);
    }
  }

  async function deleteSavedBook(bookId) {
    try {
      await window.FocuslineLibrary.deleteBook(bookId);
      if (state.currentBook?.id === bookId) createNewBook(true);
      state.pendingDeleteId = null;
      await refreshLibrary();
      showToast("책을 삭제했습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "책을 삭제하지 못했습니다.", true);
    }
  }

  function startBookFromLibrary(book, resetProgress = false) {
    const nextBook = { ...book };
    if (resetProgress) {
      nextBook.lastReadIndex = 0;
      nextBook.lastReadAt = Date.now();
      nextBook.completed = false;
      window.FocuslineLibrary.updateProgress(nextBook.id, 0, nextBook.wordCount, false, {
        readMilliseconds: nextBook.readMilliseconds,
        targetWpm: bookTargetWpm(nextBook),
      }).then(refreshLibrary).catch(() => {
        showToast("진행률을 초기화하지 못했습니다.", true);
      });
    }
    loadBookIntoEditor(nextBook);
    startReader();
  }

  function handleLibraryAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const bookId = button.dataset.bookId;
    const book = state.books.find((item) => item.id === bookId);
    if (!book) return;

    switch (button.dataset.action) {
      case "read":
        startBookFromLibrary(book);
        break;
      case "restart":
        startBookFromLibrary(book, true);
        break;
      case "edit":
        loadBookIntoEditor(book, true);
        break;
      case "delete":
        state.pendingDeleteId = bookId;
        renderLibrary();
        break;
      case "cancel-delete":
        state.pendingDeleteId = null;
        renderLibrary();
        break;
      case "confirm-delete":
        deleteSavedBook(bookId);
        break;
      default:
        break;
    }
  }

  async function saveOrFocusFromLibrary() {
    if (!dom.sourceText.value.trim()) {
      closeLibrary();
      dom.sourceText.focus();
      return;
    }
    const saved = await saveCurrentBook();
    if (saved) closeLibrary();
  }

  function exportLibraryBackup() {
    const payload = {
      app: "FOCUSLINE",
      version: 1,
      exportedAt: new Date().toISOString(),
      books: state.books,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `focusline-library-${date}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`${state.books.length}권을 백업했습니다.`);
  }

  async function importLibraryBackup(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const incomingBooks = Array.isArray(payload) ? payload : payload?.books;
      if (!Array.isArray(incomingBooks)) throw new Error("FOCUSLINE 백업 파일이 아닙니다.");

      const validBooks = incomingBooks.filter((book) => (
        book && typeof book === "object" && typeof book.content === "string" && book.content.trim()
      ));
      if (!validBooks.length) throw new Error("가져올 책이 없습니다.");

      const existingIds = new Set(state.books.map((book) => book.id));
      let importedCount = 0;
      for (const book of validBooks) {
        const hasCollision = existingIds.has(book.id);
        const saved = await window.FocuslineLibrary.saveBook({
          ...book,
          id: hasCollision ? "" : book.id,
          title: hasCollision ? `${book.title || deriveBookTitle(book.content)} (가져옴)` : book.title,
        });
        existingIds.add(saved.id);
        importedCount += 1;
      }
      await refreshLibrary();
      showToast(`${importedCount}권을 가져왔습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "백업을 가져오지 못했습니다.", true);
    }
  }

  function setRangeProgress(input) {
    const minimum = Number(input.min) || 0;
    const maximum = Number(input.max) || 100;
    const value = Number(input.value);
    const progress = ((value - minimum) / (maximum - minimum)) * 100;
    input.style.setProperty("--range-progress", `${progress}%`);
  }

  function updateCssSettings() {
    document.body.dataset.theme = state.settings.theme;
    document.documentElement.style.setProperty("--reader-size", `${8.2 * (state.settings.fontSize / 100)}vw`);
    document.documentElement.style.setProperty("--reader-size-short", `${11 * (state.settings.fontSize / 100)}vh`);
    document.documentElement.style.setProperty("--reader-tracking", `${state.settings.tracking}px`);

    const fonts = {
      serif: 'ui-serif, Georgia, "AppleMyungjo", "Nanum Myeongjo", serif',
      sans: 'ui-sans-serif, "Apple SD Gothic Neo", Pretendard, system-ui, sans-serif',
      readable: '"Atkinson Hyperlegible", "Arial Rounded MT Bold", ui-sans-serif, system-ui, sans-serif',
    };
    document.documentElement.style.setProperty("--reader-font", fonts[state.settings.typeface] || fonts.serif);
    dom.readerView.classList.toggle("focus-off", !state.settings.focusHighlight);
    dom.readerView.classList.toggle("focus-high-contrast", state.settings.focusHighlight && state.settings.highContrastFocus);
  }

  function syncControlsFromSettings() {
    dom.wpmRange.value = String(state.settings.wpm);
    dom.longWordToggle.checked = state.settings.longWordPacing;
    dom.punctuationToggle.checked = state.settings.punctuationPacing;
    dom.focusToggle.checked = state.settings.focusHighlight;
    dom.highContrastFocusToggle.checked = state.settings.highContrastFocus;
    dom.fontSizeRange.value = String(state.settings.fontSize);
    dom.trackingRange.value = String(state.settings.tracking);
    dom.typefaceSelect.value = state.settings.typeface;

    const context = document.querySelector(`input[name="context"][value="${state.settings.context}"]`);
    const theme = document.querySelector(`input[name="theme"][value="${state.settings.theme}"]`);
    if (context) context.checked = true;
    if (theme) theme.checked = true;

    updateSettingLabels();
    updateCssSettings();
  }

  function updateSettingLabels() {
    dom.wpmOutput.value = `${state.settings.wpm} WPM`;
    dom.readerWpm.value = `${state.settings.wpm} WPM`;
    dom.fontSizeOutput.value = `${state.settings.fontSize}%`;
    dom.trackingOutput.value = state.settings.tracking > 0 ? `+${state.settings.tracking}` : String(state.settings.tracking);
    [dom.wpmRange, dom.fontSizeRange, dom.trackingRange].forEach(setRangeProgress);
  }

  function tokenizeText(text) {
    return (text.normalize("NFC").trim().match(/\S+/gu) || []).filter(Boolean);
  }

  function isWordCharacter(character) {
    return /[\p{L}\p{N}]/u.test(character);
  }

  function getFocusIndex(word) {
    const characters = Array.from(word);
    const wordCharacterIndexes = [];
    characters.forEach((character, index) => {
      if (isWordCharacter(character)) wordCharacterIndexes.push(index);
    });

    const length = wordCharacterIndexes.length;
    if (length === 0) return characters.length ? 0 : -1;

    let ordinal = 0;
    if (length <= 1) ordinal = 0;
    else if (length <= 5) ordinal = 1;
    else if (length <= 9) ordinal = 2;
    else if (length <= 13) ordinal = 3;
    else ordinal = 4;

    return wordCharacterIndexes[Math.min(ordinal, length - 1)];
  }

  function readableLength(word) {
    return Array.from(word).filter(isWordCharacter).length;
  }

  function longWordBonusPercent(word) {
    const length = readableLength(word);
    let bonus = 0;
    if (length > 6) bonus += (length - 6) * 6;
    if (length > 10) bonus += (length - 10) * 9;
    if (length > 14) bonus += (length - 14) * 12;

    const joiners = (word.match(/[-–—']/gu) || []).length;
    if (joiners > 0) {
      bonus += joiners * 14;
      if (length >= 10) bonus += 18;
    }
    return Math.min(170, bonus);
  }

  function punctuationBonusPercent(word) {
    const normalized = word.replace(/[”’"'»)\]}]+$/gu, "");
    if (/…$|\.\.\.$/u.test(normalized)) return 110;
    if (/,$/u.test(normalized)) return 45;
    if (/[-–—]$/u.test(normalized)) return 60;
    if (/[;:]$/u.test(normalized)) return 80;
    if (/[!?！？]$/u.test(normalized)) return 150;
    if (/[.。]$/u.test(normalized)) return 135;
    return 0;
  }

  function getWordDurationMs(word) {
    const baseInterval = 60000 / state.settings.wpm;
    let bonus = 0;
    if (state.settings.longWordPacing) bonus += longWordBonusPercent(word) * 2;
    if (state.settings.punctuationPacing) bonus += punctuationBonusPercent(word) * 2;
    return Math.max(20, Math.round(baseInterval + bonus));
  }

  function rebuildTiming() {
    state.durations = state.tokens.map(getWordDurationMs);
    state.prefixDurations = new Array(state.durations.length + 1).fill(0);
    for (let index = 0; index < state.durations.length; index += 1) {
      state.prefixDurations[index + 1] = state.prefixDurations[index] + state.durations[index];
    }
  }

  function formatRemaining(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function remainingDurationMs() {
    if (!state.tokens.length) return 0;
    if (state.ended) return 0;
    const afterCurrent = state.prefixDurations[state.tokens.length] - state.prefixDurations[state.index + 1];
    const currentRemaining = state.playing
      ? Math.max(0, state.remainingMs - (performance.now() - state.wordStartedAt))
      : state.remainingMs || state.durations[state.index] || 0;
    return currentRemaining + afterCurrent;
  }

  function renderProgress() {
    const maximumIndex = Math.max(1, state.tokens.length - 1);
    const ratio = state.tokens.length <= 1 ? (state.ended ? 1 : 0) : state.index / maximumIndex;
    const sliderValue = Math.round(ratio * 1000);
    dom.progressRange.value = String(sliderValue);
    dom.progressRange.style.setProperty("--range-progress", `${ratio * 100}%`);
    dom.progressOutput.value = `${Math.round(ratio * 100)}%`;
    dom.remainingTime.value = `남은 시간 ${formatRemaining(remainingDurationMs())}`;
  }

  function recordReadingDuration() {
    if (!state.readStartedAt) return;
    const elapsed = Math.max(0, performance.now() - state.readStartedAt);
    state.readStartedAt = 0;
    if (!state.currentBook) return;
    state.currentBook.readMilliseconds = Math.max(0, Number(state.currentBook.readMilliseconds) || 0) + elapsed;
  }

  function persistBookProgress(immediate = false) {
    if (!state.currentBook || !state.tokens.length) return Promise.resolve(null);

    state.currentBook.lastReadIndex = state.index;
    state.currentBook.wordCount = state.tokens.length;
    state.currentBook.lastReadAt = Date.now();
    state.currentBook.completed = state.ended;
    state.currentBook.targetWpm = state.settings.wpm;
    const cachedBook = state.books.find((book) => book.id === state.currentBook.id);
    if (cachedBook) {
      cachedBook.lastReadIndex = state.currentBook.lastReadIndex;
      cachedBook.wordCount = state.currentBook.wordCount;
      cachedBook.lastReadAt = state.currentBook.lastReadAt;
      cachedBook.completed = state.currentBook.completed;
      cachedBook.readMilliseconds = state.currentBook.readMilliseconds;
      cachedBook.targetWpm = state.currentBook.targetWpm;
    }

    const writeProgress = async () => {
      state.progressSaveTimerId = 0;
      try {
        const updated = await window.FocuslineLibrary.updateProgress(
          state.currentBook.id,
          state.currentBook.lastReadIndex,
          state.currentBook.wordCount,
          state.currentBook.completed,
          {
            readMilliseconds: state.currentBook.readMilliseconds,
            targetWpm: state.currentBook.targetWpm,
          },
        );
        if (updated && state.currentBook?.id === updated.id) state.currentBook = updated;
        return updated;
      } catch (_error) {
        return null;
      }
    };

    if (immediate) {
      window.clearTimeout(state.progressSaveTimerId);
      state.progressSaveTimerId = 0;
      return writeProgress();
    }
    if (!state.progressSaveTimerId) {
      state.progressSaveTimerId = window.setTimeout(writeProgress, 700);
    }
    return Promise.resolve(null);
  }

  function renderWord() {
    if (!state.tokens.length) return;
    const word = state.ended ? "끝" : state.tokens[state.index];
    const characters = Array.from(word);
    const focusIndex = getFocusIndex(word);

    dom.wordBefore.textContent = characters.slice(0, focusIndex).join("");
    dom.wordFocus.textContent = focusIndex >= 0 ? characters[focusIndex] : "";
    dom.wordAfter.textContent = characters.slice(focusIndex + 1).join("");

    const showPrevious = state.settings.context === "previous" || state.settings.context === "both";
    const showNext = state.settings.context === "both";
    dom.previousWord.textContent = showPrevious && state.index > 0 && !state.ended ? state.tokens[state.index - 1] : "";
    dom.nextWord.textContent = showNext && state.index + 1 < state.tokens.length && !state.ended ? state.tokens[state.index + 1] : "";

    dom.wordMain.style.transform = "translate(0, -50%)";
    void dom.wordMain.offsetWidth;
    const focusCenter = dom.wordFocus.offsetLeft + dom.wordFocus.offsetWidth / 2;
    const sidePadding = Math.max(16, window.innerWidth * 0.05);
    const availableSide = Math.max(1, (window.innerWidth / 2) - sidePadding);
    const leftExtent = Math.max(1, focusCenter);
    const rightExtent = Math.max(1, dom.wordMain.offsetWidth - focusCenter);
    const fitScale = Math.min(1, availableSide / leftExtent, availableSide / rightExtent);
    dom.wordMain.style.transform = `translate(${-focusCenter * fitScale}px, -50%) scale(${fitScale})`;

    dom.readerView.classList.toggle("is-paused", !state.playing);
    const playLabel = state.ended
      ? "다시 읽기"
      : state.playing
        ? "일시정지"
        : state.hasPlayed
          ? "계속 읽기"
          : "재생";
    dom.playLabel.textContent = playLabel;
    dom.playButton.setAttribute("aria-label", playLabel);
    renderProgress();
  }

  function clearPlaybackTimer() {
    if (state.timerId) {
      window.clearTimeout(state.timerId);
      state.timerId = 0;
    }
  }

  function scheduleCurrentWord() {
    clearPlaybackTimer();
    if (!state.playing || state.ended) return;

    state.remainingMs = state.remainingMs || state.durations[state.index] || 200;
    state.wordStartedAt = performance.now();
    state.timerId = window.setTimeout(onCurrentWordElapsed, state.remainingMs);
  }

  function onCurrentWordElapsed() {
    state.timerId = 0;
    if (!state.playing) return;

    if (state.index >= state.tokens.length - 1) {
      recordReadingDuration();
      state.playing = false;
      state.ended = true;
      state.remainingMs = 0;
      renderWord();
      persistBookProgress(true);
      showControls();
      return;
    }

    state.index += 1;
    state.remainingMs = state.durations[state.index];
    renderWord();
    persistBookProgress();
    scheduleCurrentWord();
  }

  function play() {
    if (!state.tokens.length) return;
    if (state.ended) {
      state.index = 0;
      state.ended = false;
      state.remainingMs = state.durations[0];
      if (state.currentBook) state.currentBook.completed = false;
    }
    if (state.playing) return;

    state.playing = true;
    state.hasPlayed = true;
    state.readStartedAt = performance.now();
    state.remainingMs = state.remainingMs || state.durations[state.index];
    renderWord();
    scheduleCurrentWord();
    hideControlsSoon();
  }

  function pause() {
    if (!state.playing) return;
    const elapsed = performance.now() - state.wordStartedAt;
    state.remainingMs = Math.max(20, state.remainingMs - elapsed);
    recordReadingDuration();
    state.playing = false;
    clearPlaybackTimer();
    renderWord();
    persistBookProgress(true);
    showControls();
  }

  function togglePlayback() {
    if (state.playing) pause();
    else play();
  }

  function beginStageTap(event) {
    if (!state.playing) return;
    state.stagePointer = {
      id: event.pointerId,
      startedAt: performance.now(),
      x: event.clientX,
      y: event.clientY,
    };
  }

  function endStageTap(event) {
    const start = state.stagePointer;
    state.stagePointer = null;
    if (!start || start.id !== event.pointerId || !state.playing) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (performance.now() - start.startedAt <= 320 && distance < 18) {
      event.preventDefault();
      pause();
    }
  }

  function seekTo(index, preservePlayback = true) {
    if (!state.tokens.length) return;
    const wasPlaying = state.playing && preservePlayback;
    clearPlaybackTimer();
    state.index = clamp(Math.round(index), 0, state.tokens.length - 1);
    state.ended = false;
    state.remainingMs = state.durations[state.index];
    state.playing = wasPlaying;
    renderWord();
    persistBookProgress();
    if (wasPlaying) scheduleCurrentWord();
  }

  function seekRelative(offset) {
    seekTo(state.index + offset);
  }

  function stopHoldSeek(button) {
    window.clearTimeout(state.holdDelayId);
    window.clearTimeout(state.holdRepeatId);
    state.holdDelayId = 0;
    state.holdRepeatId = 0;
    const activeButton = state.holdButton || button;
    const pointerId = state.holdPointerId;
    state.holdPointerId = null;
    state.holdButton = null;
    activeButton.classList.remove("is-holding");
    dom.readerView.classList.remove("is-hold-seeking");
    if (
      pointerId !== null &&
      activeButton.hasPointerCapture &&
      activeButton.hasPointerCapture(pointerId)
    ) {
      activeButton.releasePointerCapture(pointerId);
    }
  }

  function scheduleHoldSeek(direction, button) {
    if (state.holdButton !== button || state.holdPointerId === null || state.playing || state.ended) return;
    seekRelative(direction);
    const baseIntervalMs = Math.round(60000 / state.settings.wpm);
    const intervalMs = clamp(state.durations[state.index] || baseIntervalMs, 40, 6000);
    state.holdRepeatId = window.setTimeout(() => scheduleHoldSeek(direction, button), intervalMs);
  }

  function startHoldSeek(direction, button, event) {
    if (state.playing || state.ended) return;
    event.preventDefault();
    event.stopPropagation();
    stopHoldSeek(button);
    state.holdPointerId = event.pointerId;
    state.holdButton = button;
    if (button.setPointerCapture && event.pointerId !== undefined) {
      button.setPointerCapture(event.pointerId);
    }

    seekRelative(direction);
    button.classList.add("is-holding");
    dom.readerView.classList.add("is-hold-seeking");
    const baseIntervalMs = Math.round(60000 / state.settings.wpm);
    const firstIntervalMs = clamp(state.durations[state.index] || baseIntervalMs, 40, 6000);
    state.holdDelayId = window.setTimeout(() => {
      scheduleHoldSeek(direction, button);
    }, Math.max(360, firstIntervalMs));
  }

  function bindHoldSeek(button, direction) {
    button.addEventListener("pointerdown", (event) => startHoldSeek(direction, button, event));
    ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach((eventName) => {
      button.addEventListener(eventName, () => stopHoldSeek(button));
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      stopHoldSeek(button);
    });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function stopAllHoldSeek() {
    stopHoldSeek(state.holdButton || dom.previousHoldButton);
    dom.previousHoldButton.classList.remove("is-holding");
    dom.nextHoldButton.classList.remove("is-holding");
  }

  function wordEndsSentence(word) {
    return /(?:[.!?。！？]|…)[”’"'»)\]}]*$/u.test(word);
  }

  function rewindSentence() {
    if (!state.tokens.length) return;
    let start = state.index;
    while (start > 0 && !wordEndsSentence(state.tokens[start - 1])) start -= 1;
    if (start === state.index && start > 0) {
      start -= 1;
      while (start > 0 && !wordEndsSentence(state.tokens[start - 1])) start -= 1;
    }
    seekTo(start);
  }

  function adjustedWpm(direction) {
    const current = state.settings.wpm;
    let next = current;
    if (direction > 0) {
      next += current < 100 ? 10 : 25;
      if (current < 100 && next > 100) next = 100;
    } else {
      next -= current <= 100 ? 10 : 25;
      if (current > 100 && next < 100) next = 100;
    }
    return clamp(next, 10, 1000);
  }

  function setWpm(value) {
    const wasPlaying = state.playing;
    if (wasPlaying) pause();
    state.settings.wpm = clamp(Math.round(Number(value) || 300), 10, 1000);
    if (state.currentBook) {
      state.currentBook.targetWpm = state.settings.wpm;
      markEditorDirty();
    }
    rebuildTiming();
    state.remainingMs = state.durations[state.index] || 0;
    dom.wpmRange.value = String(state.settings.wpm);
    updateSettingLabels();
    saveSettings();
    renderProgress();
    if (wasPlaying) play();
  }

  async function requestImmersiveMode() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (_error) {
      // CSS still provides an immersive full-viewport fallback.
    }

    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape");
    } catch (_error) {
      // Orientation locking is optional and browser-dependent.
    }

    try {
      if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
    } catch (_error) {
      state.wakeLock = null;
    }
  }

  async function releaseImmersiveMode() {
    try {
      if (state.wakeLock) await state.wakeLock.release();
    } catch (_error) {
      // Wake lock may already be released by the browser.
    }
    state.wakeLock = null;

    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (_error) {
      // Orientation may not have been locked.
    }

    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    } catch (_error) {
      // Reader can still leave its CSS immersive state.
    }
  }

  function showReaderHelp(force = false) {
    if (!force && localStorage.getItem(STORAGE_KEYS.readerHintSeen) === "true") return;
    dom.readerHelpOverlay.hidden = false;
    dom.readerView.classList.add("help-open");
    dom.readerHelpDismissButton.focus();
  }

  function hideReaderHelp() {
    dom.readerHelpOverlay.hidden = true;
    dom.readerView.classList.remove("help-open");
    localStorage.setItem(STORAGE_KEYS.readerHintSeen, "true");
  }

  function startReader() {
    const tokens = tokenizeText(dom.sourceText.value);
    if (!tokens.length) {
      dom.sourceText.setAttribute("aria-invalid", "true");
      dom.editorError.textContent = "읽을 문장을 한 단어 이상 입력해 주세요.";
      dom.sourceText.focus();
      return;
    }

    dom.sourceText.removeAttribute("aria-invalid");
    dom.editorError.textContent = "";
    localStorage.setItem(STORAGE_KEYS.draft, dom.sourceText.value);
    saveSettings();

    state.tokens = tokens;
    if (state.currentBook && state.editorDirty) saveCurrentBook({ quiet: true });
    const restartCompletedBook = Boolean(state.currentBook?.completed);
    state.index = state.currentBook && !restartCompletedBook
      ? clamp(state.currentBook.lastReadIndex || 0, 0, Math.max(0, tokens.length - 1))
      : 0;
    if (restartCompletedBook) state.currentBook.completed = false;
    state.playing = false;
    state.hasPlayed = false;
    state.ended = false;
    state.readStartedAt = 0;
    rebuildTiming();
    state.remainingMs = state.durations[0];

    document.body.classList.add("reading");
    dom.readerView.hidden = false;
    dom.readerView.classList.remove("portrait-allowed");
    updateCssSettings();
    renderWord();
    if (restartCompletedBook) persistBookProgress(true);
    requestImmersiveMode();
    showControls();
    showReaderHelp();
  }

  async function exitReader() {
    pause();
    clearPlaybackTimer();
    await persistBookProgress(true);
    document.body.classList.remove("reading");
    dom.readerView.hidden = true;
    dom.readerHelpOverlay.hidden = true;
    dom.readerView.classList.remove("help-open", "portrait-allowed");
    await releaseImmersiveMode();
    updateEditorBookStatus();
    refreshLibrary();
    dom.startButton.focus();
  }

  function showControls() {
    window.clearTimeout(state.controlsTimerId);
    dom.readerView.classList.add("controls-visible");
  }

  function hideControlsSoon() {
    window.clearTimeout(state.controlsTimerId);
    if (!state.playing) return;
    state.controlsTimerId = window.setTimeout(() => {
      dom.readerView.classList.remove("controls-visible");
    }, 700);
  }

  function cleanPastedText(text) {
    return String(text)
      .normalize("NFC")
      .replace(/\r\n?/gu, "\n")
      .replace(/\u00adu/gu, "")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n[ \t]+/gu, "\n")
      .split(/\n{2,}/gu)
      .map((paragraph) => paragraph.replace(/\n+/gu, " ").replace(/[ \t]{2,}/gu, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function cleanCurrentText() {
    const cleaned = cleanPastedText(dom.sourceText.value);
    if (!cleaned) {
      showToast("정리할 본문을 먼저 붙여넣어 주세요.", true);
      return;
    }
    if (cleaned === dom.sourceText.value) {
      showToast("이미 읽기 좋게 정리되어 있습니다.");
      return;
    }
    dom.sourceText.value = cleaned;
    updateCharacterCount();
    markEditorDirty();
    showToast("본문 줄바꿈과 공백을 정리했습니다.");
  }

  function updateCharacterCount() {
    const count = Array.from(dom.sourceText.value).length;
    dom.characterCount.value = `${count.toLocaleString("ko-KR")}자`;
    localStorage.setItem(STORAGE_KEYS.draft, dom.sourceText.value);
    if (count > 0) {
      dom.sourceText.removeAttribute("aria-invalid");
      dom.editorError.textContent = "";
    }
  }

  function markEditorDirty() {
    state.editorDirty = true;
    localStorage.setItem(STORAGE_KEYS.draftTitle, dom.bookTitle.value);
    if (state.currentBook) {
      const progress = bookProgressPercent(state.currentBook);
      const progressText = progress >= 100 ? "완독" : `${progress}% 읽음`;
      dom.currentBookStatus.textContent = `${progressText} · 저장 필요`;
    }
  }

  function applyPacingControlChange() {
    state.settings.longWordPacing = dom.longWordToggle.checked;
    state.settings.punctuationPacing = dom.punctuationToggle.checked;
    state.settings.focusHighlight = dom.focusToggle.checked;
    state.settings.highContrastFocus = dom.highContrastFocusToggle.checked;
    updateCssSettings();
    saveSettings();
  }

  function bindEvents() {
    dom.sourceText.addEventListener("input", () => {
      updateCharacterCount();
      markEditorDirty();
    });
    dom.cleanTextButton.addEventListener("click", cleanCurrentText);
    dom.bookTitle.addEventListener("input", markEditorDirty);
    dom.newBookButton.addEventListener("click", () => createNewBook());
    dom.libraryNewBookButton.addEventListener("click", () => createNewBook());
    dom.libraryButton.addEventListener("click", openLibrary);
    dom.libraryCloseButton.addEventListener("click", closeLibrary);
    dom.libraryBackdrop.addEventListener("click", closeLibrary);
    dom.libraryList.addEventListener("click", handleLibraryAction);
    dom.libraryEmptyAction.addEventListener("click", saveOrFocusFromLibrary);
    dom.libraryExportButton.addEventListener("click", exportLibraryBackup);
    dom.libraryImportButton.addEventListener("click", () => dom.libraryImportInput.click());
    dom.libraryImportInput.addEventListener("change", () => {
      const [file] = dom.libraryImportInput.files;
      dom.libraryImportInput.value = "";
      importLibraryBackup(file);
    });
    dom.saveBookButton.addEventListener("click", () => saveCurrentBook());
    dom.resetProgressButton.addEventListener("click", resetCurrentProgress);
    dom.startButton.addEventListener("click", startReader);
    dom.wpmRange.addEventListener("input", () => setWpm(dom.wpmRange.value));
    dom.wpmDown.addEventListener("click", () => setWpm(adjustedWpm(-1)));
    dom.wpmUp.addEventListener("click", () => setWpm(adjustedWpm(1)));
    dom.readerWpmDown.addEventListener("click", () => setWpm(adjustedWpm(-1)));
    dom.readerWpmUp.addEventListener("click", () => setWpm(adjustedWpm(1)));
    [dom.longWordToggle, dom.punctuationToggle, dom.focusToggle, dom.highContrastFocusToggle].forEach((input) => {
      input.addEventListener("change", applyPacingControlChange);
    });

    document.querySelectorAll('input[name="context"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.settings.context = input.value;
        saveSettings();
        renderWord();
      });
    });

    document.querySelectorAll('input[name="theme"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.settings.theme = input.value;
        updateCssSettings();
        saveSettings();
      });
    });

    dom.fontSizeRange.addEventListener("input", () => {
      state.settings.fontSize = Number(dom.fontSizeRange.value);
      updateSettingLabels();
      updateCssSettings();
      saveSettings();
      renderWord();
    });

    dom.trackingRange.addEventListener("input", () => {
      state.settings.tracking = Number(dom.trackingRange.value);
      updateSettingLabels();
      updateCssSettings();
      saveSettings();
      renderWord();
    });

    dom.typefaceSelect.addEventListener("change", () => {
      state.settings.typeface = dom.typefaceSelect.value;
      updateCssSettings();
      saveSettings();
      renderWord();
    });

    bindHoldSeek(dom.previousHoldButton, -1);
    bindHoldSeek(dom.nextHoldButton, 1);
    ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel", "blur"].forEach((eventName) => {
      window.addEventListener(eventName, stopAllHoldSeek, true);
    });
    dom.playButton.addEventListener("click", togglePlayback);
    dom.rewindButton.addEventListener("click", rewindSentence);
    dom.exitButton.addEventListener("click", exitReader);
    dom.readerHelpButton.addEventListener("click", () => showReaderHelp(true));
    dom.readerHelpDismissButton.addEventListener("click", hideReaderHelp);
    dom.portraitContinueButton.addEventListener("click", () => {
      dom.readerView.classList.add("portrait-allowed");
    });
    dom.portraitExitButton.addEventListener("click", exitReader);
    dom.progressRange.addEventListener("input", () => {
      const index = (Number(dom.progressRange.value) / 1000) * Math.max(0, state.tokens.length - 1);
      seekTo(index, false);
    });

    dom.readerStage.addEventListener("pointerdown", beginStageTap);
    dom.readerStage.addEventListener("pointerup", endStageTap);
    dom.readerStage.addEventListener("pointercancel", () => {
      state.stagePointer = null;
    });

    dom.readerView.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      showControls();
      hideControlsSoon();
    });

    dom.readerView.addEventListener("pointerdown", () => {
      if (!state.playing) return;
      showControls();
      hideControlsSoon();
    });

    window.addEventListener("resize", () => {
      if (!dom.readerView.hidden) renderWord();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.playing) pause();
      if (document.hidden) persistBookProgress(true);
    });

    window.addEventListener("pagehide", () => persistBookProgress(true));

    document.addEventListener("keydown", (event) => {
      if (!dom.libraryLayer.hidden && event.key === "Escape") {
        event.preventDefault();
        closeLibrary();
        return;
      }

      if (dom.readerView.hidden && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCurrentBook();
        return;
      }

      if (dom.readerView.hidden) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekRelative(event.shiftKey ? -10 : -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekRelative(event.shiftKey ? 10 : 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setWpm(adjustedWpm(1));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setWpm(adjustedWpm(-1));
      } else if (event.key.toLowerCase() === "r") {
        rewindSentence();
      } else if (event.key.toLowerCase() === "e") {
        exitReader();
      }
    });
  }

  async function initialize() {
    loadSettings();
    syncControlsFromSettings();
    bindEvents();
    await refreshLibrary();

    const activeBookId = localStorage.getItem(STORAGE_KEYS.activeBookId);
    const activeBook = state.books.find((book) => book.id === activeBookId);
    if (activeBook) {
      loadBookIntoEditor(activeBook);
      return;
    }

    if (activeBookId) localStorage.removeItem(STORAGE_KEYS.activeBookId);
    const savedDraft = localStorage.getItem(STORAGE_KEYS.draft);
    dom.sourceText.value = savedDraft && savedDraft.trim() ? savedDraft : DEFAULT_SAMPLE;
    dom.bookTitle.value = localStorage.getItem(STORAGE_KEYS.draftTitle) || "";
    state.editorDirty = false;
    updateCharacterCount();
    updateEditorBookStatus();
  }

  initialize();
})();
