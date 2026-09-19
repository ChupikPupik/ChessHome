package ratingsystem

import "math"

func CalculateRating(r1 float64, r2 float64, res float64) float64 {
	expected := 1.0 / (1.0 + math.Pow(10, (r2-r1)/400.0))
	newRating := r1 + 32.0*(res-expected)

	return newRating

}
