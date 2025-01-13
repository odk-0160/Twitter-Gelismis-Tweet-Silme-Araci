// ==UserScript==
// @name         Twitter Tweet Silme Paneli (Gelişmiş Özellikler)
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Twitter'da belirli bir kullanıcı adı ve kelimeye göre tweet'leri siler, gelişmiş filtreleme, otomatik kaydırma, işlem geçmişi ve hata yönetimi içerir.
// @author       odk-0160
// @match        *://twitter.com/*
// @match        *://x.com/*
// @match        *://mobile.twitter.com/*
// @match        *://mobile.x.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Panel HTML'i (Kullanıcı Dostu Arayüz)
    const panelHTML = `
        <div id="tweetDeletePanel" style="position: fixed; top: 10px; right: 10px; background: #1DA1F2; padding: 10px; border: 1px solid #ccc; z-index: 9999; box-shadow: 0 0 10px rgba(0,0,0,0.1); color: white; font-family: Arial, sans-serif; width: 300px;">
            <h3 style="margin: 0 0 10px;">Tweet Silme Paneli</h3>
            <input type="text" id="usernameInput" placeholder="Kullanıcı Adı" style="width: 100%; margin-bottom: 10px; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
            <input type="text" id="keywordInput" placeholder="Kelime" style="width: 100%; margin-bottom: 10px; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
            <button id="searchButton" style="width: 100%; margin-bottom: 10px; padding: 5px; background: white; color: #1DA1F2; border: none; border-radius: 4px; cursor: pointer;">Arama Yap</button>
            <div id="excludeSection" style="display: none;">
                <input type="text" id="excludeInput" placeholder="Hariç Tutulacak Tweet ID'leri (Nokta ile ayırın)" style="width: 100%; margin-bottom: 10px; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
                <button id="addExcludeButton" style="width: 100%; margin-bottom: 10px; padding: 5px; background: white; color: #1DA1F2; border: none; border-radius: 4px; cursor: pointer;">ID'leri Ekle</button>
                <div id="excludeList" style="margin-bottom: 10px;"></div>
            </div>
            <button id="deleteButton" style="width: 100%; margin-bottom: 10px; padding: 5px; background: white; color: #1DA1F2; border: none; border-radius: 4px; cursor: pointer; display: none;">Tweetleri Sil</button>
            <button id="stopButton" style="width: 100%; margin-bottom: 10px; padding: 5px; background: red; color: white; border: none; border-radius: 4px; cursor: pointer; display: none;">İşlemi Durdur</button>
            <div id="historySection" style="display: none;">
                <h4 style="margin: 0 0 10px;">İşlem Geçmişi</h4>
                <div id="historyList" style="height: 100px; overflow-y: auto; border: 1px solid #ccc; padding: 5px; background: white; color: black;"></div>
                <button id="clearHistoryButton" style="width: 100%; margin-top: 10px; padding: 5px; background: white; color: #1DA1F2; border: none; border-radius: 4px; cursor: pointer;">Geçmişi Temizle</button>
            </div>
            <div id="logOutput" style="height: 100px; overflow-y: auto; border: 1px solid #ccc; padding: 5px; font-family: monospace; font-size: 12px; background: white; color: black;"></div>
        </div>
    `;

    // Paneli sayfaya ekle
    document.body.insertAdjacentHTML('beforeend', panelHTML);

    // Logları panele yazdırma fonksiyonu
    function logToPanel(message) {
        const logOutput = document.getElementById('logOutput');
        logOutput.innerHTML += `<div>${message}</div>`;
        logOutput.scrollTop = logOutput.scrollHeight; // Otomatik kaydırma
    }

    // Hariç tutulacak ID'leri saklamak için dizi
    let excludeIds = [];

    // İşlem geçmişi
    let deletionHistory = [];

    // Arama butonu tıklama işlemi
    document.getElementById('searchButton').addEventListener('click', () => {
        const username = document.getElementById('usernameInput').value.trim();
        const keyword = document.getElementById('keywordInput').value.trim();

        if (!username || !keyword) {
            alert("Lütfen kullanıcı adı ve kelime girin!");
            return;
        }

        // Arama URL'sini oluştur ve yönlendir
        const searchURL = `https://x.com/search?q=from%3A${username}+${encodeURIComponent(keyword)}`;
        window.location.href = searchURL;
    });

    // ID'leri ekle butonu tıklama işlemi
    document.getElementById('addExcludeButton').addEventListener('click', () => {
        const excludeInput = document.getElementById('excludeInput').value.trim();
        if (!excludeInput) {
            alert("Lütfen hariç tutulacak ID'leri girin!");
            return;
        }

        // ID'leri nokta ile ayır ve diziye ekle
        const ids = excludeInput.split('.').map(id => id.trim()).filter(id => id);
        excludeIds = [...new Set([...excludeIds, ...ids])]; // Tekrar eden ID'leri kaldır

        // ID'leri görsel olarak göster
        const excludeList = document.getElementById('excludeList');
        excludeList.innerHTML = excludeIds.map(id => `<span style="display: inline-block; background: #f0f0f0; color: black; padding: 2px 5px; border-radius: 3px; margin: 2px;">${id}</span>`).join('');

        logToPanel(`📌 Hariç tutulan ID'ler: ${excludeIds.join(', ')}`);
    });

    // Silme işlemini durdurma değişkeni
    let isStopped = false;

    // Tweet silme fonksiyonu (Otomatik Kaydırma)
    async function deleteTweets() {
        let totalDeleted = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 50;

        while (scrollAttempts < maxScrollAttempts && !isStopped) {
            try {
                const tweets = document.querySelectorAll('[data-testid="tweet"]');
                if (tweets.length === 0) {
                    logToPanel("⏭️ Silinecek tweet bulunamadı. Sayfa kaydırılıyor...");
                    window.scrollTo(0, document.body.scrollHeight);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    scrollAttempts++;
                    continue;
                }

                for (const tweet of tweets) {
                    if (isStopped) break; // İşlem durdurulduysa döngüyü kır

                    const tweetLink = tweet.querySelector('a[href*="/status/"]');
                    const tweetId = tweetLink?.href.split('/status/')[1];

                    // Hariç tutulacak ID kontrolü
                    if (tweetId && excludeIds.includes(tweetId)) {
                        logToPanel(`🚫 Hariç tutulan tweet atlandı: ${tweetId}`);
                        continue;
                    }

                    const menuButton = tweet.querySelector('[data-testid="caret"]');
                    if (menuButton) {
                        menuButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        const deleteButton = await findDeleteButton();
                        if (deleteButton) {
                            deleteButton.click();
                            await new Promise(resolve => setTimeout(resolve, 1000));

                            const confirmButton = document.querySelector('[data-testid="confirmationSheetConfirm"]');
                            if (confirmButton) {
                                confirmButton.click();
                                totalDeleted++;
                                logToPanel(`✅ Tweet silindi. Toplam silinen tweet sayısı: ${totalDeleted}`);
                                deletionHistory.push({ id: tweetId, timestamp: new Date().toLocaleString() });
                                updateHistory();
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
                    }
                }

                logToPanel(`⬇️ Sayfa kaydırılıyor... Kaydırma denemesi: ${scrollAttempts + 1}`);
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(resolve => setTimeout(resolve, 3000));
                scrollAttempts++;
            } catch (error) {
                // Hata yönetimi
                logToPanel(`❌ Hata oluştu: ${error.message}`);
                console.error(error);
                break;
            }
        }

        if (isStopped) {
            logToPanel("🛑 İşlem kullanıcı tarafından durduruldu.");
        } else {
            logToPanel(`🏁 İşlem tamamlandı. Toplam silinen tweet sayısı: ${totalDeleted}`);
        }
    }

    // Sil butonunu bulma fonksiyonu
    async function findDeleteButton() {
        await new Promise(resolve => setTimeout(resolve, 500));
        const menuItems = document.querySelectorAll('[role="menuitem"]');
        for (const item of menuItems) {
            const span = item.querySelector('span');
            if (span && span.textContent === "Sil") {
                return item;
            }
        }
        return null;
    }

    // İşlem geçmişini güncelleme fonksiyonu
    function updateHistory() {
        const historyList = document.getElementById('historyList');
        historyList.innerHTML = deletionHistory.map(entry => `<div>ID: ${entry.id} - ${entry.timestamp}</div>`).join('');
    }

    // Tweet silme butonu tıklama işlemi
    document.getElementById('deleteButton').addEventListener('click', () => {
        isStopped = false;
        deleteTweets();
    });

    // İşlemi durdur butonu tıklama işlemi
    document.getElementById('stopButton').addEventListener('click', () => {
        isStopped = true;
    });

    // Geçmişi temizle butonu tıklama işlemi
    document.getElementById('clearHistoryButton').addEventListener('click', () => {
        deletionHistory = [];
        updateHistory();
    });

    // Sayfa yüklendiğinde panel durumunu kontrol et
    function checkPageAndShowPanel() {
        const isSearchPage = window.location.href.includes("/search");
        if (isSearchPage) {
            document.getElementById('excludeSection').style.display = 'block';
            document.getElementById('deleteButton').style.display = 'block';
            document.getElementById('stopButton').style.display = 'block';
            document.getElementById('historySection').style.display = 'block';
        }
    }

    // Sayfa yüklendiğinde ve her URL değişikliğinde kontrol et
    window.addEventListener('load', () => {
        setTimeout(checkPageAndShowPanel, 3000); // 3 saniye sonra kontrol et
    });
    window.addEventListener('popstate', () => {
        setTimeout(checkPageAndShowPanel, 3000); // 3 saniye sonra kontrol et
    });

    // Sayfa dinamik olarak yüklendiğinde de kontrol et (Twitter/X için)
    const observer = new MutationObserver(() => {
        checkPageAndShowPanel();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
