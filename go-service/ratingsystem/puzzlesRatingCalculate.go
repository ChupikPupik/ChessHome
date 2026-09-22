package ratingsystem

import (
	"math"
)

func CalculatePuzzleRating(ratingPlayer float64, puzzleRating float64, res float64) float64 {
	expected := 1.0 / (1.0 + math.Pow(10, (puzzleRating-ratingPlayer)/400.0))
	newUserRating := ratingPlayer + 32.0*(res-expected)

	return newUserRating
}
