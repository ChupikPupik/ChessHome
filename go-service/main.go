package main

import (
	"context"
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

func testPageHandler(w http.ResponseWriter, r *http.Request) {
	var clubsCount int
	err := db.QueryRow(context.Background(), "SELECT COUNT(*) FROM clubs").Scan(&clubsCount)
	if err != nil {
		http.Error(w, "Ошибка базы: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tmpl, err := template.ParseFiles("../public/test.html")
	if err != nil {
		http.Error(w, "Ошибка шаблона: "+err.Error(), http.StatusInternalServerError)
		return
	}

	data := map[string]int{
		"ClubsCount": clubsCount,
	}

	tmpl.Execute(w, data)

}

func dbTestHandler(w http.ResponseWriter, r *http.Request) {
	var count int
	err := db.QueryRow(context.Background(), "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		http.Error(w, "Ошибка базы: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"users_count": count})
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("Не задана переменная окружения DATABASE_URL")
	}

	var err error
	db, err = pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatal("Не удалось подключиться к базе: ", err)
	}
	defer db.Close()

	if err := db.Ping(context.Background()); err != nil {
		log.Fatal("База не отвечает на ping: ", err)
	}
	log.Println("Подключение к Postgres успешно")

	mux := http.NewServeMux()

	mux.HandleFunc("/test", testPageHandler)
	mux.HandleFunc("/dbtest", dbTestHandler)

	nodeURL, _ := url.Parse("http://127.0.0.1:10000")
	proxy := httputil.NewSingleHostReverseProxy(nodeURL)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	})

	port := os.Getenv("GO_PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("Go-сервис слушает 127.0.0.1:%s\n", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, mux))
}
