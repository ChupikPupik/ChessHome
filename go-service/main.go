package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func pageHandler(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "../public/test.html")
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/test", pageHandler)

	fmt.Println()
	port := os.Getenv("GO_PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("Go-сервис слушает 127.0.0.1:%s\n", port)
	// Слушаем ТОЛЬКО на localhost — снаружи сервис недоступен напрямую,
	// доступ только через nginx. Так безопаснее.
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, mux))
}
