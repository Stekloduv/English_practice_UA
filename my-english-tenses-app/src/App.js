import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore'; // Import getFirestore even if not explicitly used for data storage here

// Declare Canvas-specific global variables for local development to avoid ESLint 'no-undef' errors.
// Their actual values will still be checked for 'undefined' within the useEffect.
let __app_id, __firebase_config, __initial_auth_token;

// Main application component
const App = () => {
    // Internal state for managing navigation between screens
    const [currentPage, setCurrentPage] = useState('start'); // 'start' or 'practice'

    // State for selecting tenses, themes and number of sentences
    const [selectedTenses, setSelectedTenses] = useState([]);
    const [selectedThemes, setSelectedThemes] = useState(''); // New state for themes
    const [numSentences, setNumSentences] = useState(5);

    // State for tracking current practice progress
    const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
    const [sentencesData, setSentencesData] = useState([]); // [{ originalSentence, userAnswer, geminiReview, tenseUsed }]
    const [userAnswer, setUserAnswer] = useState('');
    const [currentReview, setCurrentReview] = useState(''); // Changed to useState for proper update

    // Loading state for API requests
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // State for Firebase
    const [userId, setUserId] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Set to store generated sentences to ensure uniqueness
    const [generatedSentencesSet, setGeneratedSentencesSet] = useState(new Set());

    // New state for displaying tense in practice
    const [showTenseInPractice, setShowTenseInPractice] = useState(true); // Default to true

    // Available tenses for selection, structured by time groups
    const availableTenses = [
        {
            group: "Present Tenses",
            tenses: ["Present Simple", "Present Continuous", "Present Perfect", "Present Perfect Continuous"]
        },
        {
            group: "Past Tenses",
            tenses: ["Past Simple", "Past Continuous", "Past Perfect", "Past Perfect Continuous"]
        },
        {
            group: "Future Tenses",
            tenses: ["Future Simple", "Future Continuous", "Future Perfect", "Future Perfect Continuous"]
        }
    ];

    // Firebase initialization and authentication
    useEffect(() => {
        try {
            // Check if global Firebase variables are available
            // Provide fallback values for local development
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const firebaseConfigRaw = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}'; // Default to empty object string
            let firebaseConfig;
            try {
                firebaseConfig = JSON.parse(firebaseConfigRaw);
            } catch (e) {
                console.error("Failed to parse firebaseConfig:", e);
                firebaseConfig = {}; // Fallback to empty object on parse error
            }
            const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

            // Only initialize Firebase if a valid config is provided or if we're in the Canvas environment
            // where it might be implicitly handled. For local, we need at least an empty object
            // to avoid errors if firebaseConfig is null.
            if (Object.keys(firebaseConfig).length > 0) { // Check if config has keys, indicating it's not just an empty default
                const app = initializeApp(firebaseConfig);
                const firestoreDb = getFirestore(app);
                const firebaseAuth = getAuth(app);

                setDb(firestoreDb);
                setAuth(firebaseAuth);

                // Authentication state change listener
                const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        // If user is not authenticated, try to sign in anonymously or with a token
                        try {
                            if (initialAuthToken) {
                                await signInWithCustomToken(firebaseAuth, initialAuthToken);
                            } else {
                                await signInAnonymously(firebaseAuth);
                            }
                            setUserId(firebaseAuth.currentUser?.uid || crypto.randomUUID());
                        } catch (error) {
                            console.error("Firebase authentication error:", error);
                            setErrorMessage("Authentication error. Please try again later.");
                            setUserId(crypto.randomUUID()); // Generate a random ID if authentication fails
                        }
                    }
                    setIsAuthReady(true); // Mark authentication as ready
                });

                // Cleanup listener on component unmount
                return () => unsubscribe();
            } else {
                console.warn("Firebase config is empty or invalid. Running without full Firebase functionality (only local userId).");
                setUserId(crypto.randomUUID()); // Fallback for userId for local dev
                setIsAuthReady(true); // Still ready for basic app functions
            }
        } catch (error) {
            console.error("Firebase initialization error:", error);
            setErrorMessage("Failed to initialize Firebase. Check console.");
            setUserId(crypto.randomUUID()); // Fallback for userId
            setIsAuthReady(true);
        }
    }, []); // Run only once when the component mounts

    // Function to generate sentences using the Gemini API (modified for multiple sentences)
    const generateSentences = async (tenses, themes, numberOfSentences, usedSentences) => {
        setIsLoading(true);
        setErrorMessage('');
        try {
            const chosenTenses = tenses.length > 0 ? tenses : ["Present Simple"]; // Use all selected tenses or default
            const tensesPrompt = chosenTenses.join(', ');

            let prompt = `Створи ${numberOfSentences} простих, унікальних речень українською мовою. Кожне речення має відповідати одному з граматичних часів: ${tensesPrompt}. Надай лише речення, кожне на новому рядку, без зайвого тексту чи нумерації. Кожне речення повинно бути у форматі "Речення українською [Назва Часу]". Наприклад: "Я їм яблуко. [Present Simple]".`;

            if (themes) {
                prompt += ` Тема речень: ${themes}.`;
            }

            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });

            const payload = { contents: chatHistory };
            const apiKey = "AIzaSyD3odRPIIHeSA76__kNl-YNLDmh7X6U1g0"; // Replace with your actual API key

            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const rawSentences = result.candidates[0].content.parts[0].text.trim();
                const parsedSentences = [];
                const lines = rawSentences.split('\n');

                for (const line of lines) {
                    const match = line.match(/(.*) \[(.*?)\]$/); // Matches "Sentence [Tense Name]"
                    if (match && match.length === 3) {
                        const sentenceText = match[1].trim();
                        const tenseText = match[2].trim();
                        if (!usedSentences.has(sentenceText)) {
                            usedSentences.add(sentenceText);
                            parsedSentences.push({ sentence: sentenceText, tense: tenseText });
                        } else {
                            console.log(`Skipping duplicate sentence: "${sentenceText}"`);
                        }
                    } else {
                        console.warn("Could not parse sentence line:", line);
                    }
                }
                // Filter out any sentences that failed to parse or were duplicates,
                // and take up to numberOfSentences
                return parsedSentences.slice(0, numberOfSentences);
            } else {
                throw new Error("Unexpected response structure from Gemini or no content generated.");
            }
        } catch (error) {
            console.error("Sentence generation error:", error);
            setErrorMessage(`Failed to generate sentences: ${error.message}. Please try again.`);
            return null;
        } finally {
            setIsLoading(false);
        }
    };

    // Function to get user answer review using Gemini API
    const getSentenceReview = async (originalSentenceUk, userAnswerEn) => {
        setIsLoading(true);
        setErrorMessage('');
        try {
            // Updated prompt for review, considering Ukrainian original sentence and English answer
            const reviewPrompt = `Оригінальне речення українською: "${originalSentenceUk}". Відповідь користувача англійською: "${userAnswerEn}". Надайте відповідь по наступній структурі: 1. Чи правильне написання речення(Речення написане правильно, Речення написане неправильно, без зайвих слів), 2. "${userAnswerEn}" ---- тут варто написати граматично правильну версію речення, якщо речення написано з помилкою і підкреслити виправлені частини, 3 Стисло описати помилки якщо вони є`;

            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: reviewPrompt }] });

            const payload = { contents: chatHistory };
            const apiKey = "AIzaSyD3odRPIIHeSA76__kNl-YNLDmh7X6U1g0"; // Replace with your actual API key

            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                return result.candidates[0].content.parts[0].text.trim();
            } else {
                throw new Error("Unexpected response structure from Gemini.");
            }
        } catch (error) {
            console.error("Review retrieval error:", error);
            setErrorMessage(`Failed to get review: ${error.message}.`);
            return "Failed to get review. Please try again.";
        } finally {
            setIsLoading(false);
        }
    };

    // Handler for changing selected tenses
    const handleTenseChange = (tense) => {
        setSelectedTenses(prev =>
            prev.includes(tense) ? prev.filter(t => t !== tense) : [...prev, tense]
        );
    };

    // Start practice handler
    const handleStartPractice = async () => {
        if (selectedTenses.length === 0) {
            setErrorMessage("Будь ласка, оберіть хоча б один час для практики.");
            return;
        }
        if (numSentences <= 0) {
            setErrorMessage("Кількість речень має бути більшою за нуль.");
            return;
        }

        setIsLoading(true);
        setErrorMessage('');
        const currentGeneratedSet = new Set(); // Reset for each new practice session
        setGeneratedSentencesSet(currentGeneratedSet); // Update the state with the new set

        // Call generateSentences once to get all sentences
        const generated = await generateSentences(selectedTenses, selectedThemes, numSentences, currentGeneratedSet);

        if (generated && generated.length > 0) {
            const newSentencesData = generated.map(item => ({
                originalSentence: item.sentence,
                userAnswer: '',
                geminiReview: '',
                tenseUsed: item.tense
            }));
            setSentencesData(newSentencesData);
            setCurrentSentenceIndex(0);
            setUserAnswer('');
            setCurrentReview('');
            setCurrentPage('practice');
        } else {
            setErrorMessage("Не вдалося згенерувати речення. Спробуйте змінити критерії.");
            setSentencesData([]); // Clear previous sentences
        }
        setIsLoading(false);
    };

    // Handler for "Get Review" button click
    const handleGetReview = async () => {
        if (!userAnswer.trim()) {
            setErrorMessage("Будь ласка, введіть вашу відповідь.");
            return;
        }
        const originalSentenceUk = sentencesData[currentSentenceIndex].originalSentence;
        const review = await getSentenceReview(originalSentenceUk, userAnswer);

        const updatedSentencesData = [...sentencesData];
        updatedSentencesData[currentSentenceIndex].userAnswer = userAnswer;
        updatedSentencesData[currentSentenceIndex].geminiReview = review;
        setSentencesData(updatedSentencesData);
        setCurrentReview(review);
    };

    // Handler for "Next" / "Finish" button click
    const handleNextOrFinish = () => {
        if (currentSentenceIndex < numSentences - 1) {
            setCurrentSentenceIndex(prev => prev + 1);
            setUserAnswer('');
            setCurrentReview('');
            setErrorMessage('');
        } else {
            // End of practice, return to start screen
            setCurrentPage('start');
            setSelectedTenses([]);
            setSelectedThemes(''); // Clear themes
            setNumSentences(5);
            setSentencesData([]);
            setCurrentSentenceIndex(0);
            setUserAnswer('');
            setCurrentReview('');
            setErrorMessage('');
            setGeneratedSentencesSet(new Set()); // Clear the set of generated sentences
        }
    };

    // Render the start screen
    const renderStartScreen = () => (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4 font-inter">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
                <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">Практика англійських часів</h1>

                {/* userId message */}
                {isAuthReady && userId && (
                    <p className="text-sm text-center text-gray-600 mb-4 break-all">
                        Ваш ID користувача: <span className="font-mono bg-gray-200 px-2 py-1 rounded-md">{userId}</span>
                    </p>
                )}

                <div className="mb-6">
                    <label className="block text-lg font-semibold text-gray-700 mb-3">Оберіть часи для практики:</label>
                    {/* Iterate over tense groups */}
                    {availableTenses.map(tenseGroup => (
                        <div key={tenseGroup.group} className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <h3 className="text-xl font-bold text-gray-800 mb-3">{tenseGroup.group}</h3>
                            <div className="grid grid-cols-2 gap-3">
                                {/* Iterate over tenses within each group */}
                                {tenseGroup.tenses.map(tense => (
                                    <label key={tense} className="flex items-center space-x-2 text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedTenses.includes(tense)}
                                            onChange={() => handleTenseChange(tense)}
                                            className="form-checkbox h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500 transition duration-150 ease-in-out"
                                        />
                                        <span className="text-base">{tense}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mb-6">
                    <label className="block text-lg font-semibold text-gray-700 mb-3">Теми (необов'язково, наприклад: "подорожі", "технології"):</label>
                    <input
                        type="text"
                        value={selectedThemes}
                        onChange={(e) => setSelectedThemes(e.target.value)}
                        placeholder="Введіть теми через кому"
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-lg"
                    />
                </div>

                {/* New option: Show tense in practice */}
                <div className="mb-6">
                    <label className="flex items-center space-x-2 text-gray-800 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showTenseInPractice}
                            onChange={(e) => setShowTenseInPractice(e.target.checked)}
                            className="form-checkbox h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500 transition duration-150 ease-in-out"
                        />
                        <span className="text-lg font-semibold">Відображати час речення під час практики</span>
                    </label>
                </div>

                <div className="mb-8">
                    <label className="block text-lg font-semibold text-gray-700 mb-3">Кількість речень:</label>
                    <input
                        type="number"
                        min="1"
                        max="20"
                        value={numSentences}
                        onChange={(e) => setNumSentences(parseInt(e.target.value))}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-lg text-center"
                    />
                </div>

                {errorMessage && (
                    <p className="text-red-600 text-center mb-4">{errorMessage}</p>
                )}

                <button
                    onClick={handleStartPractice}
                    disabled={isLoading || !isAuthReady}
                    className={`w-full py-3 px-6 rounded-lg text-white font-bold text-lg shadow-lg transform transition duration-300 ease-in-out
                                ${isLoading || !isAuthReady ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105'}`}
                >
                    {isLoading ? 'Завантаження...' : 'Розпочати практику'}
                </button>
            </div>
        </div>
    );

    // Render the practice screen
    const renderPracticeScreen = () => (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4 font-inter">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl">
                <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">
                    Практика: {currentSentenceIndex + 1} з {numSentences}
                </h1>

                {/* userId message */}
                {isAuthReady && userId && (
                    <p className="text-sm text-center text-gray-600 mb-4 break-all">
                        Ваш ID користувача: <span className="font-mono bg-gray-200 px-2 py-1 rounded-md">{userId}</span>
                    </p>
                )}

                {errorMessage && (
                    <p className="text-red-600 text-center mb-4">{errorMessage}</p>
                )}

                {isLoading ? (
                    <div className="text-center text-indigo-600 text-xl font-semibold my-10">
                        Завантаження...
                    </div>
                ) : (
                    <>
                        <div className="mb-6 bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                            <p className="text-lg text-gray-700 mb-2">
                                <span className="font-semibold">Речення українською:</span>
                                {/* Conditionally display tense */}
                                {showTenseInPractice && (
                                    <span className="font-semibold ml-2">({sentencesData[currentSentenceIndex]?.tenseUsed || 'Невідомо'})</span>
                                )}
                            </p>
                            <p className="text-xl font-medium text-gray-900 leading-relaxed">
                                {sentencesData[currentSentenceIndex]?.originalSentence || 'Не вдалося завантажити речення.'}
                            </p>
                        </div>

                        <div className="mb-6">
                            <label htmlFor="userAnswer" className="block text-lg font-semibold text-gray-700 mb-3">Ваша відповідь англійською:</label>
                            <textarea
                                id="userAnswer"
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-lg h-24 resize-y"
                                value={userAnswer}
                                onChange={(e) => setUserAnswer(e.target.value)}
                                placeholder="Напишіть вашу відповідь тут..."
                            ></textarea>
                        </div>

                        <button
                            onClick={handleGetReview}
                            disabled={isLoading || !userAnswer.trim()}
                            className={`w-full py-3 px-6 rounded-lg text-white font-bold text-lg shadow-lg transform transition duration-300 ease-in-out
                                        ${isLoading || !userAnswer.trim() ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 hover:scale-105'}`}
                        >
                            {isLoading ? 'Отримання огляду...' : 'Отримати огляд'}
                        </button>

                        {currentReview && (
                            <div className="mb-8 bg-blue-50 p-4 rounded-lg border border-blue-200">
                                <p className="text-lg text-gray-700 mb-2 font-semibold">Огляд від Gemini:</p>
                                <p className="text-base text-gray-800 leading-relaxed">{currentReview}</p>
                            </div>
                        )}

                        <button
                            onClick={handleNextOrFinish}
                            disabled={isLoading || !currentReview} // Can only proceed after getting a review
                            className={`w-full py-3 px-6 rounded-lg text-white font-bold text-lg shadow-lg transform transition duration-300 ease-in-out
                                        ${isLoading || !currentReview ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105'}`}
                        >
                            {currentSentenceIndex < numSentences - 1 ? 'Далі' : 'Завершити'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );

    return (
        // Tailwind CSS CDN
        <>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
                `}
            </style>
            {currentPage === 'start' ? renderStartScreen() : renderPracticeScreen()}
        </>
    );
};

export default App;