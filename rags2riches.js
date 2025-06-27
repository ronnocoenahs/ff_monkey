// ==UserScript==
// @name         FunFile Rags To Riches Blackjack
// @namespace    http://tampermonkey.net/
// @version      2.17 // Increased version for fixing message z-index
// @description  A client-side Blackjack game against 'Mugiwara' with betting, a poker table theme, win/loss tracking, and manual credit transfers. Now with a start screen!
// @author       Gemini
// @match        https://www.funfile.org/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest // Added for fetching Mugiwara's profile
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- Game Configuration ---
    const DEALER_NAME = "Mugiwara";
    const DEALER_IMAGE_URL = "https://ptpimg.me/95xrpn.jpg"; // Mugiwara's image URL
    const PLAYER_AVATAR_PLACEHOLDER_URL = "https://placehold.co/100x100/333/ecf0f1"; // Generic placeholder if user avatar not found
    const MUGIWARA_PROFILE_ID = 377548; // Mugiwara's specific user ID for profile page
    // These multipliers are for display and calculation within the game.
    // Actual transfers are done manually via mycredits.php.
    const BLACKJACK_PAYOUT_MULTIPLIER = 1.5; // Blackjack typically pays 3:2 (1.5x bet)
    const REGULAR_WIN_MULTIPLIER = 1;       // Regular win pays 1:1 (1x bet)
    const BET_TIMEOUT_MS = 10000; // Still here for illustration, not used for prompt.

    // --- Greasemonkey Storage Keys ---
    const STORAGE_KEY_PENDING_CREDIT = 'ff_blackjack_pending_credit';
    const STORAGE_KEY_RECIPIENT = 'ff_blackjack_recipient';
    const STORAGE_KEY_AMOUNT = 'ff_blackjack_amount';
    const STORAGE_KEY_REASON = 'ff_blackjack_reason';
    // New storage keys for persistent player stats
    const STORAGE_KEY_WINS = 'ff_blackjack_wins';
    const STORAGE_KEY_LOSSES = 'ff_blackjack_losses';
    const STORAGE_KEY_TOTAL_EARNED = 'ff_blackjack_total_earned';
    const STORAGE_KEY_TOTAL_LOST = 'ff_blackjack_total_lost';
    // New storage keys for messaging Mugiwara
    const STORAGE_KEY_MESSAGE_PENDING = 'ff_blackjack_message_pending';
    const STORAGE_KEY_MESSAGE_RECIPIENT = 'ff_blackjack_message_recipient';
    const STORAGE_KEY_MESSAGE_SUBJECT = 'ff_blackjack_message_subject';
    const STORAGE_KEY_MESSAGE_BODY = 'ff_blackjack_message_body';


    // --- Blackjack Game Variables ---
    let deck = [];
    let playerHand = [];
    let dealerHand = [];
    let gameOver = false;
    let currentBet = 0;
    let currentUsersCredits = 0; // Displayed credits within the game
    let actualUsersUsername = ''; // To store the current logged-in user's username
    let actualUserAvatarUrl = PLAYER_AVATAR_PLACEHOLDER_URL; // To store the current logged-in user's avatar URL
    let wins = 0; // Track wins (now persistent)
    let losses = 0; // Track losses (now persistent)
    let totalEarned = 0; // Track total credits earned in game (now persistent)
    let totalLost = 0;   // Track total credits lost in game (now persistent)
    let betTimeoutId = null;

    // --- UI Elements (will be populated once the DOM is ready) ---
    let gameModal, dealerHandDiv, dealerScoreDiv, playerHandDiv, playerScoreDiv, gameMessageDiv, hitBtn, standBtn, newGameBtn;
    let currentCreditsDisplay, winsDisplayElement, lossesDisplayElement, totalEarnedDisplay, totalLostDisplay, transferCreditsBtn, reportTotalsBtn; // Added reportTotalsBtn
    let rags2RichesTitle; // For the text in the middle of the table
    let betInput, placeBetBtn, bettingAreaDiv; // New UI elements for betting
    let playerNameDisplayElement; // Reference to the player's name display element
    let playerAvatarImageElement; // Reference to the player's avatar image element

    // New modal elements
    let startScreenModal;
    let dealerStatsModal;
    // Removed topWinnersModal and topLosersModal

    // --- Card Deck Logic ---
    const suits = ['♥', '♦', '♣', '♠']; // Heart, Diamond, Club, Spade emojis
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    // Creates a new 52-card deck
    function createDeck() {
        deck = [];
        for (let suit of suits) {
            for (let rank of ranks) {
                deck.push({ rank, suit });
            }
        }
        shuffleDeck();
    }

    // Shuffles the deck using Fisher-Yates algorithm
    function shuffleDeck() {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]]; // Swap elements
        }
    }

    // Deals a single card from the deck
    function dealCard() {
        if (deck.length === 0) {
            createDeck(); // Reshuffle if deck is empty
            console.warn("Deck ran out, reshuffling!");
        }
        return deck.pop();
    }

    // Calculates the score of a hand, handling Aces (1 or 11)
    function getHandValue(hand) {
        let value = 0;
        let aceCount = 0;

        for (let card of hand) {
            if (card.rank === 'A') {
                aceCount++;
                value += 11;
            } else if (['K', 'Q', 'J'].includes(card.rank)) {
                value += 10;
            } else {
                value += parseInt(card.rank);
            }
        }

        // Adjust for Aces if busting
        while (value > 21 && aceCount > 0) {
            value -= 10;
            aceCount--;
        }
        return value;
    }

    // Converts a card object to its display string
    function getCardDisplay(card) {
        return `<div class="card-rank">${card.rank}</div><div class="card-suit ${ (card.suit === '♥' || card.suit === '♦') ? 'red-suit' : ''}">${card.suit}</div>`;
    }

    // --- DOM Parsing for User Credits, Name, and Avatar ---
    function readUserCreditsAndNameFromPage() {
        // Look for the specific div that contains the user's information on the main page
        const userInfoDiv = document.querySelector('div[style*="float: left; margin: 5px 0 0 14px;"]');

        if (userInfoDiv) {
            // Get the username (bold link to profile)
            const usernameLink = userInfoDiv.querySelector('a[style*="font-weight: bold;"]');
            if (usernameLink) {
                actualUsersUsername = usernameLink.textContent.trim();

                // Explicitly parse the profile URL for the current player's ID for demonstration
                const profileHref = usernameLink.href;
                const urlParams = new URLSearchParams(profileHref.split('?')[1]);
                const playerId = urlParams.get('id');
                if (playerId) {
                    console.log(`FunFile Blackjack: Identified current player's name from profile link: "${actualUsersUsername}" (ID: ${playerId})`);
                } else {
                    console.warn(`FunFile Blackjack: Could not extract player ID from profile link: ${profileHref}`);
                }

                // Update the player's name display in the game if the element exists
                if (playerNameDisplayElement) {
                    playerNameDisplayElement.textContent = actualUsersUsername;
                }
            }

            // Attempt to find the user's avatar. This assumes an <img> tag exists within or near userInfoDiv
            // A more robust selector might be needed based on FunFile's specific HTML structure.
            const userAvatarImg = userInfoDiv.querySelector('img[src*="user_avatars/"]'); // Example: look for img with 'user_avatars/' in src
            if (userAvatarImg && userAvatarImg.src) {
                actualUserAvatarUrl = userAvatarImg.src;
                console.log(`FunFile Blackjack: Identified current player's avatar: "${actualUserAvatarUrl}"`);
                if (playerAvatarImageElement) {
                    playerAvatarImageElement.src = actualUserAvatarUrl;
                }
            } else {
                 console.warn("FunFile Blackjack: Could not find player's avatar image within the user info div. Using placeholder.");
                 actualUserAvatarUrl = PLAYER_AVATAR_PLACEHOLDER_URL; // Fallback to placeholder
                 if (playerAvatarImageElement) {
                    playerAvatarImageElement.src = actualUserAvatarUrl;
                 }
            }


            // Within this div, find the 'a' tag that contains 'cr.' (for credits)
            const creditLink = userInfoDiv.querySelector('a[href*="mycredits.php"]');
            if (creditLink) {
                const creditText = creditLink.textContent;
                const creditMatch = creditText.match(/(\d[\d,]*\.?\d*)\s*cr\./i);
                if (creditMatch && creditMatch[1]) {
                    let creditAmount = parseFloat(creditMatch[1].replace(/,/g, ''));
                    currentUsersCredits = creditAmount; // Set initial credits for game
                    return creditAmount;
                }
            }
        }
        console.warn("FunFile Blackjack: Could not determine current user credits or username from the page.");
        return 0; // Default to 0 if not found
    }

    // --- Game UI Elements and Styling ---

    GM_addStyle(`
        /* Ensure html and body are set up for full viewport height */
        html, body {
            height: 100%;
            margin: 0;
            padding: 0;
            /* No overflow: hidden here. It should only apply to the modal when open. */
        }

        /* Main Button Styling (for the button that opens the game) */
        #ragsToRichesBtnContainer {
            width: 100%; /* Ensure it takes full width */
            text-align: center; /* Center child elements (the button) */
            margin: 15px 0; /* Add some vertical spacing, adjust as needed */
            clear: both; /* Important to clear any floats above it */
            box-sizing: border-box; /* Include padding/border in width */
        }
        #ragsToRichesBtn {
            background-color: #333; /* Dark background */
            color: #ecf0f1; /* Light text color */
            padding: 6px 20px; /* Slimmed down padding */
            border: none;
            border-radius: 6px; /* Slimmer border-radius */
            font-size: 1.2em; /* Slimmer font size */
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3); /* Slimmer shadow */
            text-transform: uppercase;
            letter-spacing: 1px;
            display: inline-block; /* Now it's inside a text-align: center parent */
            background-image: linear-gradient(to bottom right, #444, #222); /* Subtle gradient */
            border: 1px solid #555; /* Slightly lighter border */
            max-width: 180px; /* Constrain width to make it slimmer */
            white-space: nowrap; /* Prevent text wrap */
        }
        #ragsToRichesBtn:hover {
            background-color: #555; /* Lighter on hover */
            transform: translateY(-1px); /* Less dramatic lift */
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4); /* Adjusted shadow on hover */
            background-image: linear-gradient(to bottom right, #555, #333);
        }
        #ragsToRichesBtn:active {
            transform: translateY(0);
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
        }


        /* Generic Modal Backdrop and Content (reused for game, start screen, stats, leaderboards) */
        .blackjack-modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.85); /* Darker overlay */
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 100000; /* Ensure it's on top */
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.4s ease, visibility 0.4s ease;
        }
        .blackjack-modal-backdrop.show {
            opacity: 1;
            visibility: visible;
        }

        .blackjack-modal-content {
            background-color: #2c3e50; /* Fallback for if image fails, or to blend with */
            padding: 20px; /* Reduced padding slightly for more space */
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            text-align: center;
            max-width: 900px; /* Wider to provide more space */
            width: 95%;
            height: 85vh; /* Fixed height to prevent scrolling */
            overflow: hidden; /* Prevent internal scrolling within the modal */
            margin: 20px auto; /* Add margin for spacing from edges */
            transform: scale(0.9);
            transition: transform 0.4s ease;
            color: #ecf0f1; /* Light grey text */
            font-family: 'Arial', sans-serif;
            border: 3px solid #f39c12; /* Orange border */

            /* Poker table theme for game modal */
            background-image: linear-gradient(to bottom, rgba(0,0,0,0.6), rgba(0,0,0,0.8)), url('https://placehold.co/900x500/228B22/228B22'); /* Removed text, matched background color */
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            background-blend-mode: overlay; /* Blend mode can affect overall look */
        }
        /* Only apply grid to the main game modal */
        #blackjackGameModal .blackjack-modal-content {
            display: grid; /* Use grid for main game layout */
            grid-template-areas:
                "stats-header stats-header stats-header"
                ". betting-area ."
                "dealer-info . player-info"
                "dealer-hand game-message player-hand"
                ". controls ."
                ". bottom-controls .";
            grid-template-columns: 1fr 2fr 1fr;
            grid-template-rows: auto /* stats-header */
                                auto /* betting-area */
                                auto /* dealer/player info block (name, avatar, score) */
                                2fr  /* hands and message (flexible height) */
                                auto /* controls */
                                auto; /* bottom-controls */
            gap: 5px 0;
            align-items: center;
            justify-content: center;
        }

        /* Generic modal styling for other screens (start, stats) */
        .blackjack-start-screen-modal .blackjack-modal-content,
        .blackjack-dealer-stats-modal .blackjack-modal-content {
            display: flex; /* Use flexbox for simple stacking of content */
            flex-direction: column;
            justify-content: center;
            align-items: center;
            max-width: 600px; /* Slightly narrower for these informational modals */
            height: auto; /* Adjust height based on content */
            min-height: 300px; /* Minimum height */
            padding: 30px;
        }
        .blackjack-start-screen-modal .blackjack-modal-content {
            background-image: linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.9)), url('https://placehold.co/600x400/1A362D/1A362D'); /* Darker green theme */
            background-size: cover;
        }
        .blackjack-dealer-stats-modal .blackjack-modal-content {
            background-image: linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.9)), url('https://placehold.co/600x400/2C3E50/2C3E50'); /* Dark blue/grey theme */
            background-size: cover;
        }


        .blackjack-modal-backdrop.show .blackjack-modal-content {
            transform: scale(1);
        }

        /* Close Button (X) - applies to all modals now */
        .blackjack-modal-backdrop .blackjack-close-btn-x {
            background: none;
            border: none;
            color: #ecf0f1;
            font-size: 2em;
            cursor: pointer;
            padding: 5px 10px;
            position: absolute; /* Absolute positioning */
            top: 10px; /* Top right corner */
            right: 10px;
            z-index: 10; /* Ensure it's above other content */
            transition: color 0.2s ease;
        }
        .blackjack-modal-backdrop .blackjack-close-btn-x:hover {
            color: #e74c3c; /* Red on hover */
        }

        /* Stats Header Styling (for game modal) */
        .blackjack-stats-header {
            grid-area: stats-header; /* Updated grid area name */
            font-size: 1.3em;
            font-weight: bold;
            color: #f39c12;
            margin-bottom: 5px; /* Reduced margin */
            padding: 5px 10px; /* Reduced padding */
            border-bottom: none; /* Removed border-bottom for underlining */
            text-shadow: 1px 1px 3px rgba(0,0,0,0.5);
            width: 100%; /* Occupy full width of grid area */
            display: flex; /* Use flexbox for internal alignment of stats */
            justify-content: center; /* Center content within the header */
            align-items: center;
            flex-wrap: wrap; /* Allow wrapping on smaller screens */
            gap: 0 15px; /* Space between stat items */
            text-decoration: none; /* Explicitly remove any default underline */
        }
        .blackjack-stats-header span {
            color: #ecf0f1;
            font-weight: normal;
            display: inline-block; /* Ensure labels and values stay together but allow wrapping */
        }
        .blackjack-stats-header .value {
            color: #2ecc71;
            font-weight: bold;
        }
        .blackjack-stats-header .value.loss {
            color: #e74c3c;
        }
        .blackjack-stats-header .value.earned {
            color: #2ecc71;
        }
        .blackjack-stats-header .value.lost {
            color: #e74c3c;
        }


        /* Combined Info Sections (Name, Avatar, Score) - for game modal */
        .dealer-info, .player-info {
            display: flex;
            flex-direction: column; /* Stack name, avatar, score vertically */
            align-items: center; /* Center items horizontally */
            justify-content: flex-start; /* Align to top of grid area */
            padding-top: 10px; /* Some padding from the top */
            position: relative; /* For name display positioning */
        }
        .dealer-info { grid-area: dealer-info; }
        .player-info { grid-area: player-info; }

        .name-display {
            font-size: 1.2em;
            font-weight: bold;
            color: #f1c40f; /* Yellowish for names */
            margin-bottom: 5px; /* Space between name and avatar */
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }

        .avatar-container {
            width: 90px; /* Slightly smaller avatar to save space */
            height: 90px;
            border-radius: 50%;
            border: 3px solid #f39c12;
            overflow: hidden;
            margin-bottom: 5px; /* Reduced space between avatar and score */
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: #333; /* Fallback for avatar */
        }
        .avatar-container img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        .score-display {
            margin-top: 0;
            margin-bottom: 5px;
            color: #f1c40f;
            font-size: 1.1em;
            font-weight: bold; /* Make the "Hand:" text bold */
        }
        .score-display .score-value {
            color: #ecf0f1; /* White for the actual score value */
            font-weight: normal; /* Keep the score value normal weight */
        }


        /* Betting Area (now visible input) */
        .blackjack-betting-area {
            grid-area: betting-area; /* Assigned grid area */
            display: flex; /* Flexbox for centering input and button */
            justify-content: center;
            align-items: center;
            margin-top: 5px; /* Reduced margin */
            margin-bottom: 15px; /* Reduced margin */
            flex-wrap: wrap;
        }
        .blackjack-betting-area input[type="number"] {
            width: 120px; /* Slightly wider input field */
            padding: 10px 15px; /* More padding */
            border-radius: 8px; /* More rounded */
            border: 2px solid #555; /* Darker border */
            background-color: #ecf0f1;
            color: #333;
            font-size: 1.1em; /* Larger font */
            text-align: center;
            -moz-appearance: textfield;
            box-shadow: inset 0 2px 5px rgba(0,0,0,0.1); /* Subtle inner shadow */
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .blackjack-betting-area input[type="number"]:focus {
            outline: none;
            border-color: #3498db; /* Blue focus border */
            box-shadow: inset 0 2px 5px rgba(0,0,0,0.1), 0 0 8px rgba(52,152,219,0.5); /* Glow on focus */
        }
        .blackjack-betting-area input[type="number"]::-webkit-outer-spin-button,
        .blackjack-betting-area input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .blackjack-betting-area button {
            background-color: #3498db; /* Blue for place bet */
            color: white;
            padding: 10px 20px; /* Consistent padding with other buttons */
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1.1em;
            font-weight: bold;
            margin-left: 15px;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.1s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-transform: uppercase;
            background-image: linear-gradient(to bottom right, #3498db, #2980b9);
        }
        .blackjack-betting-area button:hover {
            background-color: #2980b9;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            background-image: linear-gradient(to bottom right, #2980b9, #206da0);
        }
        .blackjack-betting-area button:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        .blackjack-betting-area button:disabled {
            background-color: #7f8c8d;
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
            background-image: none;
        }


        .blackjack-message {
            grid-area: game-message; /* Corrected to 'game-message' from 'message' to match grid area */
            font-size: 1.5em; /* Slightly smaller for compactness */
            font-weight: bold;
            margin: 0; /* Remove top/bottom margins */
            padding: 10px;
            border-radius: 8px;
            background-color: rgba(0,0,0,0.2);
            color: #ecf0f1;
            min-height: 1.5em;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 6; /* Added z-index to be above the Rags2Riches title */
        }
        .blackjack-message.win { color: #2ecc71; }
        .blackjack-message.lose { color: #e74c3c; }
        .blackjack-message.push { color: #3498db; }
        .blackjack-message.playing { color: #f1c40f; }
        .blackjack-message.error { color: #e74c3c; }

        /* Rags 2 Riches Title (for game modal) */
        #rags2RichesTitle {
            position: absolute; /* Keep absolute to layer over grid cells */
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%); /* Center perfectly */
            font-family: 'Luckiest Guy', cursive, 'Impact', 'Arial Black', sans-serif;
            font-size: 4em; /* Adjusted size to be more like a logo */
            color: rgba(255, 215, 0, 1); /* Fully opaque gold color */
            text-shadow: 3px 3px 7px rgba(0,0,0,0.8); /* Stronger shadow for definition */
            line-height: 0.8; /* Tighter line height for stacked words */
            pointer-events: none; /* Allow clicks to pass through */
            white-space: nowrap; /* Prevent wrapping if possible */
            z-index: 5; /* Ensure it's above background, below cards/avatars */
        }
        #rags2RichesTitle span {
            display: block; /* Each word on its own line */
            text-align: center;
        }

        /* Card Display */
        .blackjack-hand {
            display: flex;
            justify-content: center; /* Center cards horizontally */
            align-items: center;
            /* flex-wrap: wrap; Removed to prevent wrapping and allow controlled overlap */
            margin-bottom: 0;
            min-height: 80px;
            padding: 5px 0;
        }
        /* Specific grid areas for hands */
        #dealerHandDiv { grid-area: dealer-hand; }
        #playerHandDiv { grid-area: player-hand; }

        .blackjack-card {
            background-color: #fefefe;
            color: #333;
            border: 2px solid #555;
            border-radius: 12px;
            padding: 5px;
            margin-left: -30px; /* Negative margin to create overlap */
            /* The first card in the hand should not have a negative margin on its left */
            margin-top: 3px; /* Small top margin for vertical spacing */
            margin-bottom: 3px; /* Small bottom margin for vertical spacing */
            font-weight: bold;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            width: 70px;
            height: 100px;
            box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.3);
            text-shadow: none;
            position: relative; /* Essential for z-index and correct layering */
            overflow: hidden;
            font-family: 'Georgia', serif;
            background-image: linear-gradient(to bottom right, #fefefe, #e0e0e0);
            z-index: 1; /* Default z-index */
            transition: transform 0.2s ease; /* Smooth transition for hover if added */
        }
        .blackjack-card:first-child {
            margin-left: 0; /* Remove negative margin for the first card */
        }
        .blackjack-card:nth-child(2) { z-index: 2; } /* Layering for better visibility */
        .blackjack-card:nth-child(3) { z-index: 3; }
        .blackjack-card:nth-child(4) { z-index: 4; }
        .blackjack-card:nth-child(5) { z-index: 5; }
        /* Add more if players can get more cards */

        .blackjack-card .card-rank {
            font-size: 1.8em; /* Adjusted font size */
            line-height: 1;
            margin-top: 3px;
        }
        .blackjack-card .card-suit {
            font-size: 1.6em; /* Adjusted font size */
            line-height: 1;
            margin-bottom: 3px;
        }
        .blackjack-card .card-suit.red-suit {
            color: #e74c3c;
        }
        .blackjack-card.hidden-card {
            background-color: #3f0000;
            color: #e74c3c;
            border: 2px solid #a93226;
            font-size: 1.4em; /* Adjusted font size */
            justify-content: center;
            align-items: center;
            text-align: center;
            line-height: 1;
            display: flex;
        }

        /* Buttons (Hit, Stand, New Game) */
        .blackjack-controls {
            grid-area: controls;
            margin-top: 10px; /* Reduced margin */
            display: flex;
            justify-content: center;
            gap: 10px; /* Reduced gap between buttons */
            flex-wrap: wrap;
        }
        .blackjack-controls button {
            background-color: #444;
            color: white;
            padding: 8px 18px; /* Slightly smaller padding */
            border: 1px solid #666;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1em; /* Reduced font size */
            font-weight: bold;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.1s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-transform: uppercase;
            background-image: linear-gradient(to bottom right, #555, #333);
        }
        .blackjack-controls button:hover {
            background-color: #666;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            background-image: linear-gradient(to bottom right, #666, #444);
        }
        .blackjack-controls button:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        .blackjack-controls button:disabled {
            background-color: #7f8c8d;
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
            background-image: none;
        }

        /* Specific button overrides for colors */
        #blackjackHitBtn { background-color: #2ecc71; background-image: linear-gradient(to bottom right, #2ecc71, #27ae60); }
        #blackjackHitBtn:hover { background-color: #27ae60; background-image: linear-gradient(to bottom right, #27ae60, #229954); }

        #blackjackStandBtn { background-color: #e67e22; background-image: linear-gradient(to bottom right, #e67e22, #d35400); }
        #blackjackStandBtn:hover { background-color: #d35400; background-image: linear-gradient(to bottom right, #d35400, #bb4400); }

        #blackjackNewGameBtn { background-color: #3498db; background-image: linear-gradient(to bottom right, #3498db, #2980b9); }
        #blackjackNewGameBtn:hover { background-color: #2980b9; background-image: linear-gradient(to bottom right, #2980b9, #206da0); }

        /* Bottom Controls (Transfer and Report) */
        .bottom-controls {
            grid-area: bottom-controls;
            display: flex;
            justify-content: center;
            margin-top: 5px; /* Reduced margin */
            gap: 15px;
            flex-wrap: wrap;
        }
        .bottom-controls button {
            background-color: #444;
            color: white;
            padding: 10px 20px;
            border: 1px solid #666;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1.1em;
            font-weight: bold;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.1s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-transform: uppercase;
            background-image: linear-gradient(to bottom right, #555, #333);
        }
        .bottom-controls button:hover {
            background-color: #666;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            background-image: linear-gradient(to bottom right, #666, #444);
        }
        .bottom-controls button:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }

        #transferCreditsBtn { background-color: #f39c12; background-image: linear-gradient(to bottom right, #f39c12, #e67e22); }
        #transferCreditsBtn:hover { background-color: #e67e22; background-image: linear-gradient(to bottom right, #e67e22, #d35400); }

        #reportTotalsBtn { background-color: #8e44ad; background-image: linear-gradient(to bottom right, #8e44ad, #9b59b6); } /* Purple color for new button */
        #reportTotalsBtn:hover { background-color: #9b59b6; background-image: linear-gradient(to bottom right, #9b59b6, #a977c0); }


        /* Start Screen Specific Styles */
        .start-screen-title {
            font-family: 'Luckiest Guy', cursive, 'Impact', 'Arial Black', sans-serif;
            font-size: 3.5em; /* Smaller than in-game title */
            color: #f1c40f;
            text-shadow: 2px 2px 5px rgba(0,0,0,0.7);
            margin-bottom: 30px;
            line-height: 0.9;
        }
        .start-screen-title span {
            display: block;
        }

        .start-screen-buttons {
            display: flex;
            flex-direction: column;
            gap: 15px;
            width: 80%; /* Control width of buttons */
            max-width: 300px;
        }
        .start-screen-buttons button {
            background-color: #34495e; /* Darker blue-grey */
            color: white;
            padding: 12px 25px;
            border: none;
            border-radius: 8px;
            font-size: 1.2em;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
            text-transform: uppercase;
            letter-spacing: 1px;
            background-image: linear-gradient(to bottom right, #4a6580, #2c3e50);
        }
        .start-screen-buttons button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
            background-image: linear-gradient(to bottom right, #5c7b99, #3f586f);
        }
        .start-screen-buttons button:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }

        /* Specific colors for start screen buttons */
        #startNewGameBtn { background-color: #2ecc71; background-image: linear-gradient(to bottom right, #2ecc71, #27ae60); }
        #startNewGameBtn:hover { background-color: #27ae60; background-image: linear-gradient(to bottom right, #27ae60, #229954); }

        #viewDealerStatsBtn { background-color: #f39c12; background-image: linear-gradient(to bottom right, #f39c12, #e67e22); }
        #viewDealerStatsBtn:hover { background-color: #e67e22; background-image: linear-gradient(to bottom right, #e67e22, #d35400); }

        /* Leaderboard content has been removed, but if you re-add it, these styles will apply. */
        .leaderboard-content h2 {
            color: #f1c40f;
            margin-bottom: 20px;
            font-size: 2em;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.5);
        }
        .leaderboard-content p {
            font-size: 1.3em;
            margin-bottom: 10px;
            color: #ecf0f1;
        }
        .leaderboard-content .note {
            font-size: 0.9em;
            color: #bbb;
            margin-top: 20px;
        }
    `);

    // Function to create a generic modal backdrop and content structure
    function createModalBase(id, contentHTML, modalClass, closeCallback) {
        const modal = document.createElement('div');
        modal.id = id;
        modal.className = `blackjack-modal-backdrop ${modalClass}`;

        const modalContent = document.createElement('div');
        modalContent.className = 'blackjack-modal-content';
        modalContent.innerHTML = contentHTML;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'blackjack-close-btn-x';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', closeCallback);
        modalContent.prepend(closeBtn); // Add close button at the top

        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        return modal;
    }

    // Function to show a modal
    function showModal(modalElement) {
        if (modalElement) {
            modalElement.classList.add('show');
            modalElement.style.visibility = 'visible'; // Ensure visibility is set
        }
    }

    // Function to hide a modal
    function hideModal(modalElement) {
        if (modalElement) {
            modalElement.classList.remove('show');
            setTimeout(() => {
                modalElement.style.visibility = 'hidden';
            }, 400); // Match transition duration
        }
    }


    // --- Create Blackjack Game Modal ---
    function createGameModal() {
        if (gameModal) return; // Prevent recreation

        const gameContentHTML = `
            <div class="blackjack-stats-header">
                <span class="label">cr.:</span> <span class="value" id="currentCreditsDisplay">0.00</span>
                <span class="label">Wins:</span> <span class="value" id="winsDisplay">0</span>
                <span class="label">Losses:</span> <span class="value" id="lossesDisplay">0</span>
                <span class="label">Earned:</span> <span class="value earned" id="totalEarnedDisplay">0.00</span>
                <span class="label">Lost:</span> <span class="value lost" id="totalLostDisplay">0.00</span>
            </div>
            <div class="blackjack-betting-area">
                <input type="number" id="betInput" min="1" placeholder="Enter Bet" value="10">
                <button id="placeBetBtn">Place Bet</button>
            </div>
            <div class="dealer-info">
                <div class="name-display">${DEALER_NAME}</div>
                <div class="avatar-container"><img src="${DEALER_IMAGE_URL}" alt="${DEALER_NAME} dealer image" onerror="this.onerror=null;this.src='https://placehold.co/100x100/333/ecf0f1';"></div>
                <div class="score-display">Hand: <span class="score-value" id="dealerScore"></span></div>
            </div>
            <div class="player-info">
                <div class="name-display" id="playerNameDisplayElement">Your Name</div>
                <div class="avatar-container"><img src="${actualUserAvatarUrl}" alt="Your avatar" id="playerAvatarImageElement" onerror="this.onerror=null;this.src='${PLAYER_AVATAR_PLACEHOLDER_URL}';"></div>
                <div class="score-display">Hand: <span class="score-value" id="playerScore"></span></div>
            </div>
            <div id="dealerHandDiv" class="blackjack-hand"></div>
            <div id="playerHandDiv" class="blackjack-hand"></div>
            <div id="gameMessageDiv" class="blackjack-message playing">Place your bet to start!</div>
            <div class="blackjack-controls">
                <button id="blackjackHitBtn">Hit</button>
                <button id="blackjackStandBtn">Stand</button>
                <button id="blackjackNewGameBtn" style="display: none;">New Hand</button>
            </div>
            <div class="bottom-controls">
                <button id="transferCreditsBtn">Transfer Credits</button>
                <button id="reportTotalsBtn">Report Totals to Mugiwara</button>
            </div>
            <div id="rags2RichesTitle"><span>RAGS</span><span>2</span><span>RICHES</span></div>
        `;

        gameModal = createModalBase('blackjackGameModal', gameContentHTML, '', () => hideModal(gameModal));

        // Assign UI elements after creation
        currentCreditsDisplay = gameModal.querySelector('#currentCreditsDisplay');
        winsDisplayElement = gameModal.querySelector('#winsDisplay');
        lossesDisplayElement = gameModal.querySelector('#lossesDisplay');
        totalEarnedDisplay = gameModal.querySelector('#totalEarnedDisplay');
        totalLostDisplay = gameModal.querySelector('#totalLostDisplay');
        betInput = gameModal.querySelector('#betInput');
        placeBetBtn = gameModal.querySelector('#placeBetBtn');
        dealerHandDiv = gameModal.querySelector('#dealerHandDiv');
        dealerScoreDiv = gameModal.querySelector('#dealerScore');
        playerHandDiv = gameModal.querySelector('#playerHandDiv');
        playerScoreDiv = gameModal.querySelector('#playerScore');
        gameMessageDiv = gameModal.querySelector('#gameMessageDiv');
        hitBtn = gameModal.querySelector('#blackjackHitBtn');
        standBtn = gameModal.querySelector('#blackjackStandBtn');
        newGameBtn = gameModal.querySelector('#blackjackNewGameBtn');
        transferCreditsBtn = gameModal.querySelector('#transferCreditsBtn');
        reportTotalsBtn = gameModal.querySelector('#reportTotalsBtn');
        bettingAreaDiv = gameModal.querySelector('.blackjack-betting-area');
        playerNameDisplayElement = gameModal.querySelector('#playerNameDisplayElement'); // Assign player name element
        playerAvatarImageElement = gameModal.querySelector('#playerAvatarImageElement'); // Assign player avatar element


        // Event listeners for game buttons
        hitBtn.addEventListener('click', playerHit);
        standBtn.addEventListener('click', playerStand);
        newGameBtn.addEventListener('click', resetGame);
        placeBetBtn.addEventListener('click', handlePlaceBet);
        transferCreditsBtn.addEventListener('click', redirectToCreditTransfer);
        reportTotalsBtn.addEventListener('click', sendPayoutReport);

        setGameControlState(false); // Game controls disabled initially
        updateStatsDisplay(); // Update initial win/loss/earned/lost display
    }

    // --- Create Start Screen Modal ---
    function createStartScreenModal() {
        if (startScreenModal) return;

        const startScreenContentHTML = `
            <div class="start-screen-title"><span>RAGS</span><span>2</span><span>RICHES</span></div>
            <div class="start-screen-buttons">
                <button id="startNewGameBtn">Start New Game</button>
                <button id="viewDealerStatsBtn">View Dealer Stats</button>
                <!-- Removed Top 10 Winners/Losers buttons -->
            </div>
        `;
        startScreenModal = createModalBase('blackjackStartScreenModal', startScreenContentHTML, 'blackjack-start-screen-modal', () => hideModal(startScreenModal));

        // Event listeners for start screen buttons
        startScreenModal.querySelector('#startNewGameBtn').addEventListener('click', () => {
            hideModal(startScreenModal);
            showGameModal();
        });
        startScreenModal.querySelector('#viewDealerStatsBtn').addEventListener('click', () => {
            hideModal(startScreenModal);
            showDealerStatsModal();
        });
        // Removed event listeners for Top 10 Winners/Losers
    }

    // --- Create Dealer Stats Modal ---
    function createDealerStatsModal() {
        if (dealerStatsModal) return;

        const dealerStatsContentHTML = `
            <h2>Your Stats Against ${DEALER_NAME}</h2>
            <div class="dealer-stats-content">
                <p>Total Games Won: <span class="stat-value">${GM_getValue(STORAGE_KEY_WINS, 0)}</span></p>
                <p>Total Games Lost: <span class="stat-value">${GM_getValue(STORAGE_KEY_LOSSES, 0)}</span></p>
                <p>Total Credits Earned: <span class="stat-value earned">${GM_getValue(STORAGE_KEY_TOTAL_EARNED, 0).toFixed(2)} cr.</span></p>
                <p>Total Credits Lost: <span class="stat-value lost">${GM_getValue(STORAGE_KEY_TOTAL_LOST, 0).toFixed(2)} cr.</span></p>
            </div>
            <p class="note"><em>Note: These are your personal stats tracked client-side and do not reflect ${DEALER_NAME}'s overall statistics across all players.</em></p>
        `;
        dealerStatsModal = createModalBase('blackjackDealerStatsModal', dealerStatsContentHTML, 'blackjack-dealer-stats-modal', () => {
            hideModal(dealerStatsModal);
            showModal(startScreenModal); // Return to start screen
        });
    }

    // Removed createTopWinnersModal and createTopLosersModal functions


    // --- Game Flow Functions ---

    // Updates the win/loss/total earned/lost display
    function updateStatsDisplay() {
        if (currentCreditsDisplay) currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);
        if (winsDisplayElement) winsDisplayElement.textContent = wins;
        if (lossesDisplayElement) lossesDisplayElement.textContent = losses;
        if (totalEarnedDisplay) totalEarnedDisplay.textContent = totalEarned.toFixed(2);
        if (totalLostDisplay) totalLostDisplay.textContent = totalLost.toFixed(2);
    }

    // Loads player stats from Tampermonkey storage
    function loadPlayerStats() {
        wins = GM_getValue(STORAGE_KEY_WINS, 0);
        losses = GM_getValue(STORAGE_KEY_LOSSES, 0);
        totalEarned = GM_getValue(STORAGE_KEY_TOTAL_EARNED, 0);
        totalLost = GM_getValue(STORAGE_KEY_TOTAL_LOST, 0);
    }

    // Saves player stats to Tampermonkey storage
    function savePlayerStats() {
        GM_setValue(STORAGE_KEY_WINS, wins);
        GM_setValue(STORAGE_KEY_LOSSES, losses);
        GM_setValue(STORAGE_KEY_TOTAL_EARNED, totalEarned);
        GM_setValue(STORAGE_KEY_TOTAL_LOST, totalLost);
    }

    // Sets the state of game control buttons (hit, stand)
    function setGameControlState(enabled) {
        hitBtn.disabled = !enabled;
        standBtn.disabled = !enabled;
    }

    // Handles the "Place Bet" button click
    function handlePlaceBet() {
        const inputBet = parseFloat(betInput.value);

        if (isNaN(inputBet) || inputBet <= 0) {
            gameMessageDiv.textContent = 'Invalid bet. Please enter a positive number.';
            gameMessageDiv.classList.add('error');
            return;
        }

        if (inputBet > currentUsersCredits) {
            gameMessageDiv.textContent = `Not enough credits. You have ${currentUsersCredits.toFixed(2)} cr.`;
            gameMessageDiv.classList.add('error');
            return;
        }

        currentBet = inputBet;
        currentUsersCredits -= currentBet; // Deduct bet from displayed credits
        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);

        bettingAreaDiv.style.display = 'none'; // Hide bet input after placing bet
        gameMessageDiv.textContent = `Bet of ${currentBet.toFixed(2)} placed. Dealing cards...`;
        gameMessageDiv.className = 'blackjack-message playing';

        startGameRound();
    }


    // Resets the game state and UI for a new hand (not resetting overall stats)
    function resetGame() {
        // Clear any existing bet timeout (if repurposed for idle timer)
        if (betTimeoutId) {
            clearTimeout(betTimeoutId);
            betTimeoutId = null;
        }

        createDeck();
        playerHand = [];
        dealerHand = [];
        gameOver = false;
        currentBet = 0; // Reset bet for the new hand

        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2); // Refresh displayed credits

        gameMessageDiv.textContent = 'Place your bet for the next hand!';
        gameMessageDiv.className = 'blackjack-message playing';

        dealerHandDiv.innerHTML = ''; // Clear hands
        dealerScoreDiv.textContent = '';
        playerHandDiv.innerHTML = '';
        playerScoreDiv.textContent = '';

        hitBtn.style.display = ''; // Show Hit button
        standBtn.style.display = ''; // Show Stand button
        newGameBtn.style.display = 'none'; // Hide New Game button
        setGameControlState(false); // Disable game controls until new bet

        betInput.value = '10'; // Reset bet input value
        bettingAreaDiv.style.display = 'flex'; // Show betting area for new bet
    }

    // Starts a new game round after a bet is placed
    function startGameRound() {
        // This function is now called by handlePlaceBet after a valid bet is made
        createDeck();
        playerHand = [];
        dealerHand = [];
        gameOver = false;

        // Deal initial cards
        playerHand.push(dealCard());
        dealerHand.push(dealCard()); // Dealer's first card
        playerHand.push(dealCard());
        dealerHand.push(dealCard()); // Dealer's second card (one will be hidden)

        updateUI();
        setGameControlState(true); // Enable game controls

        // Check for immediate blackjack
        if (getHandValue(playerHand) === 21) {
            gameMessageDiv.textContent = `BLACKJACK! You win! Payout: ${(currentBet * BLACKJACK_PAYOUT_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            endGame(currentBet * BLACKJACK_PAYOUT_MULTIPLIER); // Pass payout for transfer
        }
    }

    // Updates the display of hands and scores
    function updateUI(showDealerFullHand = false) {
        // Player Hand
        playerHandDiv.innerHTML = playerHand.map((card, index) => {
            // Apply z-index based on index for correct layering, higher index on top
            return `<div class="blackjack-card" style="z-index:${index + 1};">${getCardDisplay(card)}</div>`;
        }).join('');
        playerScoreDiv.textContent = getHandValue(playerHand);

        // Dealer Hand
        dealerHandDiv.innerHTML = '';
        if (showDealerFullHand) {
            dealerHandDiv.innerHTML = dealerHand.map((card, index) => {
                 return `<div class="blackjack-card" style="z-index:${index + 1};">${getCardDisplay(card)}</div>`;
            }).join('');
            dealerScoreDiv.textContent = getHandValue(dealerHand);
        } else {
            // Show only first card, second card as hidden
            dealerHandDiv.innerHTML = `
                <div class="blackjack-card" style="z-index:1;">${getCardDisplay(dealerHand[0])}</div>
                <div class="blackjack-card hidden-card" style="z-index:2;">?</div>
            `;
            dealerScoreDiv.textContent = getHandValue([dealerHand[0]]); // Show score of only the visible card
        }
    }

    // Player action: Hit
    function playerHit() {
        if (gameOver) return;

        playerHand.push(dealCard());
        updateUI();

        if (getHandValue(playerHand) > 21) {
            gameMessageDiv.textContent = `Bust! You lose. Your bet of ${currentBet.toFixed(2)} credits will be sent to ${DEALER_NAME}.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('lose');
            endGame(-currentBet); // Pass negative bet for loss
        }
    }

    // Player action: Stand
    function playerStand() {
        if (gameOver) return;

        setGameControlState(false); // Disable player controls
        gameOver = true; // Set game over immediately

        // Dealer's turn
        updateUI(true); // Show dealer's hidden card
        dealerTurn();
    }

    // Dealer's turn logic
    function dealerTurn() {
        let dealerScore = getHandValue(dealerHand);
        while (dealerScore < 17) {
            dealerHand.push(dealCard());
            dealerScore = getHandValue(dealerHand);
            updateUI(true); // Update dealer's hand
            // Add a small delay for visual effect for a real game, but for script, just update quickly
        }
        determineWinner();
    }

    // Determines the winner of the game and calculates credit change
    function determineWinner() {
        const playerScore = getHandValue(playerHand);
        const dealerScore = getHandValue(dealerHand);
        let creditChange = 0; // The amount of credits to be transferred (can be negative for loss)

        updateUI(true); // Ensure dealer's hand is fully visible

        if (playerScore > 21) {
            // Already handled by playerHit for bust
            gameMessageDiv.textContent = `Bust! You lose. Your bet of ${currentBet.toFixed(2)} credits will be sent to ${DEALER_NAME}.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('lose');
            creditChange = -currentBet;
            losses++; // Increment loss count
            totalLost += currentBet; // Add to total lost
        } else if (dealerScore > 21) {
            gameMessageDiv.textContent = `Dealer busts! You win! Payout: ${(currentBet * REGULAR_WIN_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            creditChange = currentBet * REGULAR_WIN_MULTIPLIER;
            wins++; // Increment win count
            totalEarned += creditChange; // Add to total earned
        } else if (playerScore > dealerScore) {
            gameMessageDiv.textContent = `You win! Payout: ${(currentBet * REGULAR_WIN_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            creditChange = currentBet * REGULAR_WIN_MULTIPLIER;
            wins++; // Increment win count
            totalEarned += creditChange; // Add to total earned
        } else if (dealerScore > playerScore) {
            gameMessageDiv.textContent = `Dealer wins! You lose. Your bet of ${currentBet.toFixed(2)} credits will be sent to ${DEALER_NAME}.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('lose');
            creditChange = -currentBet;
            losses++; // Increment loss count
            totalLost += currentBet; // Add to total lost
        } else {
            gameMessageDiv.textContent = `Push! It's a tie. Your bet of ${currentBet.toFixed(2)} credits is returned.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('push');
            creditChange = 0; // Bet is returned on push
        }
        endGame(creditChange);
    }

    // Ends the current game round and prepares credit transfer
    function endGame(creditChange) {
        gameOver = true;
        setGameControlState(false); // Disable game buttons
        newGameBtn.style.display = ''; // Show New Game button
        bettingAreaDiv.style.display = 'none'; // Ensure betting area is hidden

        // Update displayed credits (add win or subtract loss from previous deduction)
        currentUsersCredits += creditChange;
        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);
        updateStatsDisplay(); // Update win/loss and total earned/lost display
        savePlayerStats(); // Save updated stats to storage

        // Prepare for manual credit transfer via mycredits.php
        if (creditChange !== 0) {
            const transferAmount = Math.abs(creditChange);
            const transferRecipient = creditChange > 0 ? actualUsersUsername : DEALER_NAME;
            const transferReason = creditChange > 0 ? `Blackjack Win: +${transferAmount.toFixed(2)}` : `Blackjack Loss: -${transferAmount.toFixed(2)}`;

            GM_setValue(STORAGE_KEY_PENDING_CREDIT, true);
            GM_setValue(STORAGE_KEY_RECIPIENT, transferRecipient);
            GM_setValue(STORAGE_KEY_AMOUNT, transferAmount);
            GM_setValue(STORAGE_KEY_REASON, transferReason);

            // Updated: Display transfer instruction in gameMessageDiv instead of alert
            gameMessageDiv.innerHTML += `<br>Credits need to be transferred. Click "Transfer Credits" to finalize on MyCredits page.`;
        }
    }

    // --- Modal Visibility Functions (for game, start screen, and new stats) ---

    // Shows the game modal and reads user credits
    async function showGameModal() {
        if (!gameModal) {
            createGameModal(); // Create elements if they don't exist
            // Load Google Font for Rags 2 Riches title
            const link = document.createElement('link');
            link.href = 'https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=swap';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        readUserCreditsAndNameFromPage(); // Call updated function to read credits, name, and avatar
        loadPlayerStats(); // Load player stats from storage
        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2); // Update initial display

        showModal(gameModal);
        // Now that the modal is shown, set up for betting
        resetGame(); // This will show the bet input and button
    }

    function showStartScreenModal() {
        if (!startScreenModal) {
            createStartScreenModal();
            // Load Google Font for Rags 2 Riches title on start screen
            const link = document.createElement('link');
            link.href = 'https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=swap';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        readUserCreditsAndNameFromPage(); // Ensure player name and avatar are loaded for potential display
        showModal(startScreenModal);
    }

    function showDealerStatsModal() {
        if (!dealerStatsModal) {
            createDealerStatsModal();
        }
        // Update stats just before showing the modal
        dealerStatsModal.querySelector('.dealer-stats-content').innerHTML = `
            <p>Total Games Won: <span class="stat-value">${GM_getValue(STORAGE_KEY_WINS, 0)}</span></p>
            <p>Total Games Lost: <span class="stat-value">${GM_getValue(STORAGE_KEY_LOSSES, 0)}</span></p>
            <p>Total Credits Earned: <span class="stat-value earned">${GM_getValue(STORAGE_KEY_TOTAL_EARNED, 0).toFixed(2)} cr.</span></p>
            <p>Total Credits Lost: <span class="stat-value lost">${GM_getValue(STORAGE_KEY_TOTAL_LOST, 0).toFixed(2)} cr.</span></p>
        `;
        showModal(dealerStatsModal);
    }

    // Removed showTopWinnersModal and showTopLosersModal functions


    // Handles redirecting to mycredits.php for manual transfer
    function redirectToCreditTransfer() {
        const pendingCredit = GM_getValue(STORAGE_KEY_PENDING_CREDIT, false);
        if (pendingCredit) {
            // Confirm with user before redirecting
            if (confirm("You have a pending credit transfer. Click OK to go to the MyCredits page to finalize it, or Cancel to stay here.")) {
                 window.location.href = 'https://www.funfile.org/mycredits.php';
            }
        } else {
            // Using a custom message box for no pending transfer, consistent with in-game messages.
            gameMessageDiv.textContent = "No pending credit transfer. Play a hand to win or lose credits!";
            gameMessageDiv.classList.add('error');
            // Consider if this should reset the game or just update the message
        }
    }

    // New function: Sends a message to Mugiwara with totals by parsing his profile
    function sendPayoutReport() {
        const mugiwaraProfileUrl = `https://www.funfile.org/userdetails.php?id=${MUGIWARA_PROFILE_ID}`;
        const messageRecipient = DEALER_NAME; // Still use Mugiwara as the recipient name for pre-filling

        gameMessageDiv.textContent = `Fetching Mugiwara's profile to compose message...`;
        gameMessageDiv.classList.remove('error'); // Clear any previous error states
        gameMessageDiv.classList.add('playing'); // Indicate activity

        GM_xmlhttpRequest({
            method: "GET",
            url: mugiwaraProfileUrl,
            onload: function(response) {
                const doc = new DOMParser().parseFromString(response.responseText, "text/html");

                // Attempt to identify Mugiwara's name from his profile page
                // The structure for username on FunFile profile pages might look like:
                // <td class="header">Username</td><td><a href="userdetails.php?id=...">Mugiwara</a></td>
                const usernameElement = doc.querySelector('td.header:first-child + td > a[href*="userdetails.php?id="]');
                if (usernameElement) {
                    const fetchedMugiwaraName = usernameElement.textContent.trim();
                    console.log(`FunFile Blackjack: Identified Mugiwara's name from profile: "${fetchedMugiwaraName}"`);
                    if (fetchedMugiwaraName !== DEALER_NAME) {
                        console.warn(`FunFile Blackjack: Discrepancy detected! Hardcoded DEALER_NAME "${DEALER_NAME}" does not match fetched name "${fetchedMugiwaraName}".`);
                    }
                } else {
                    console.warn("FunFile Blackjack: Could not find Mugiwara's username on his profile page from the specified selector.");
                }


                // Find the 'Send private message' link. This is a common pattern.
                const pmLink = doc.querySelector('a[href*="messages.php?action=compose"]');

                if (pmLink) {
                    const messageSubject = `Blackjack Game Totals Report from ${actualUsersUsername}`;
                    const messageBody = `Hello ${DEALER_NAME},\n\nHere are my final Blackjack game totals:\n\nTotal Credits Earned: ${totalEarned.toFixed(2)} cr.\nTotal Credits Lost: ${totalLost.toFixed(2)} cr.\nWins: ${wins}\nLosses: ${losses}\n\nThanks,\n${actualUsersUsername}`;

                    // The href from pmLink will contain messages.php?action=compose&id=USER_ID
                    const composeUrl = pmLink.href;

                    // Store message details for pre-filling
                    GM_setValue(STORAGE_KEY_MESSAGE_PENDING, true);
                    GM_setValue(STORAGE_KEY_MESSAGE_RECIPIENT, messageRecipient); // Store "Mugiwara"
                    GM_setValue(STORAGE_KEY_MESSAGE_SUBJECT, messageSubject);
                    GM_setValue(STORAGE_KEY_MESSAGE_BODY, messageBody);

                    window.location.href = composeUrl; // Redirect to the pre-filled message page
                } else {
                    gameMessageDiv.textContent = `Could not find "Send private message" link on Mugiwara's profile.`;
                    gameMessageDiv.classList.remove('playing');
                    gameMessageDiv.classList.add('error');
                    console.error("FunFile Blackjack: Could not find 'Send private message' link on Mugiwara's profile.");
                }
            },
            onerror: function(response) {
                gameMessageDiv.textContent = `Error fetching Mugiwara's profile. Please try again.`;
                gameMessageDiv.classList.remove('playing');
                gameMessageDiv.classList.add('error');
                console.error("FunFile Blackjack: Error fetching Mugiwara's profile:", response.status, response.statusText);
            }
        });
    }


    // --- Initialize "Rags To Riches" button ---
    function initializeRagsToRichesButton() {
        // Create a new container for the button to control its centering and layout
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'ragsToRichesBtnContainer'; // Give it an ID for styling

        const ragsToRichesBtn = document.createElement('button');
        ragsToRichesBtn.id = 'ragsToRichesBtn';
        ragsToRichesBtn.textContent = 'Rags2Riches'; // Button text
        ragsToRichesBtn.addEventListener('click', showStartScreenModal); // Open start screen
        buttonContainer.appendChild(ragsToRichesBtn);

        // Find the head_banner which typically contains the logo/site header
        const headBanner = document.querySelector('.head_banner');

        if (headBanner && headBanner.parentNode) {
            // Insert the button container directly after the head_banner within its parent
            headBanner.parentNode.insertBefore(buttonContainer, headBanner.nextSibling);
        } else {
            // Fallback: if .head_banner not found, prepend to body (original behavior)
            document.body.prepend(buttonContainer);
            console.warn("FunFile Blackjack: Could not find .head_banner. Placing Rags2Riches button at body start.");
        }
    }

    // --- Handle Page Load Actions (Credit Pre-filling and Message Pre-filling) ---
    function handlePageLoadActions() {
        // Handle pending credit transfer on mycredits.php
        if (window.location.href.includes('https://www.funfile.org/mycredits.php')) {
            const pendingCredit = GM_getValue(STORAGE_KEY_PENDING_CREDIT, false);

            if (pendingCredit) {
                const recipient = GM_getValue(STORAGE_KEY_RECIPIENT, '');
                const amount = GM_getValue(STORAGE_KEY_AMOUNT, 0);
                const reason = GM_getValue(STORAGE_KEY_REASON, '');

                const commerceUserField = document.querySelector('input[name="commerce2user"]');
                const user2userReasonField = document.querySelector('input[name="user2user_reason"]');
                const user2userAmountField = document.querySelector('input[name="user2user"]');

                if (commerceUserField && user2userReasonField && user2userAmountField) {
                    commerceUserField.value = recipient;
                    user2userReasonField.value = reason;
                    user2userAmountField.value = amount.toFixed(2); // Ensure consistent decimal format

                    alert(`Blackjack Credit Transfer Ready!\n\nThe credit exchange form has been pre-filled for:\nRecipient: ${recipient}\nAmount: ${amount.toFixed(2)} cr.\nReason: "${reason}"\n\nPlease review the details and click the "Send Credits" button to complete the transaction.`);

                    // Clear the storage flags so it doesn't pre-fill again on refresh
                    GM_deleteValue(STORAGE_KEY_PENDING_CREDIT);
                    GM_deleteValue(STORAGE_KEY_RECIPIENT);
                    GM_deleteValue(STORAGE_KEY_AMOUNT);
                    GM_deleteValue(STORAGE_KEY_REASON);
                } else {
                    console.error('FunFile Blackjack: Could not find all credit exchange form fields on mycredits.php. Is the page structure correct?');
                    // Even if fields not found, clear flags to avoid persistent errors.
                    GM_deleteValue(STORAGE_KEY_PENDING_CREDIT);
                    GM_deleteValue(STORAGE_KEY_RECIPIENT);
                    GM_deleteValue(STORAGE_KEY_AMOUNT);
                    GM_deleteValue(STORAGE_KEY_REASON);
                    alert("Blackjack credit transfer could not be set up automatically. Please check the console for errors and transfer credits manually if needed.");
                }
            }
        }

        // Handle pending message transfer on messages.php (compose)
        if (window.location.href.includes('https://www.funfile.org/messages.php?action=compose')) {
            const messagePending = GM_getValue(STORAGE_KEY_MESSAGE_PENDING, false);

            if (messagePending) {
                const recipient = GM_getValue(STORAGE_KEY_MESSAGE_RECIPIENT, '');
                const subject = GM_getValue(STORAGE_KEY_MESSAGE_SUBJECT, '');
                const body = GM_getValue(STORAGE_KEY_MESSAGE_BODY, '');

                const recipientField = document.querySelector('input[name="to"]');
                const subjectField = document.querySelector('input[name="subject"]');
                const bodyField = document.querySelector('textarea[name="body"]');

                if (recipientField && subjectField && bodyField) {
                    recipientField.value = recipient;
                    subjectField.value = subject;
                    bodyField.value = body;

                    alert(`Blackjack Game Report Ready!\n\nThe message form has been pre-filled for:\nRecipient: ${recipient}\nSubject: "${subject}"\n\nPlease review the details and click "Send Message" to send the report.`);

                    // Clear the storage flags
                    GM_deleteValue(STORAGE_KEY_MESSAGE_PENDING);
                    GM_deleteValue(STORAGE_KEY_MESSAGE_RECIPIENT);
                    GM_deleteValue(STORAGE_KEY_MESSAGE_SUBJECT);
                    GM_deleteValue(STORAGE_KEY_MESSAGE_BODY);
                } else {
                    console.error('FunFile Blackjack: Could not find all message compose form fields on messages.php. Is the page structure correct?');
                    GM_deleteValue(STORAGE_KEY_MESSAGE_PENDING);
                    GM_deleteValue(STORAGE_KEY_RECIPIENT);
                    GM_deleteValue(STORAGE_KEY_SUBJECT);
                    GM_deleteValue(STORAGE_KEY_MESSAGE_BODY);
                    alert("Blackjack message pre-filling failed. Please check console for errors.");
                }
            }
        }
    }


    // --- Run Initialization ---
    // This function will now handle all page-specific actions based on URL
    handlePageLoadActions();
    // Initialize the Rags2Riches button once the main page is loaded
    window.addEventListener('load', initializeRagsToRichesButton);

})();
