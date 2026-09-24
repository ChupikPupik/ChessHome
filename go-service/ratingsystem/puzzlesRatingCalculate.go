package ratingsystem

import (
	"math"
)

func CalculatePuzzleRating(ratingPlayer float64, puzzleRating float64, res float64) float64 {
	expected := 1.0 / (1.0 + math.Pow(10, (puzzleRating-ratingPlayer)/400.0))
	delta := 32.0 * (res - expected)
	delta = math.Max(-40, math.Min(40, delta))

	newUserRating := math.Max(100, ratingPlayer+delta)
	return newUserRating
}
