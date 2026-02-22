// app.js

document.addEventListener('DOMContentLoaded', function() {
    const playerScoresDiv = document.querySelector('.player-scores');
    if (!playerScoresDiv) {
        console.error('Player scores div not found');
        return;
    }

    for (let i = 1; i <= 20; i++) {
        const button = document.createElement('button');
        button.textContent = i;
        button.className = 'player-score';

        button.addEventListener('click', function() {
            const score = i;
            console.log(`Score recorded: ${score}`);
            // You can add code here to handle the recorded score
        });

        playerScoresDiv.appendChild(button);
    }
});